//! KMZ/KML -> GeoJSON, in-memory (no filesystem) so it runs in wasm.
//!
//! A KMZ is a zip whose main entry is `doc.kml`; we unzip in memory, parse the KML, walk
//! Placemarks (carrying `name` / `description` into GeoJSON `properties`), and emit a
//! FeatureCollection. Plain `.kml` bytes are also accepted (detected by the absence of the
//! `PK` zip magic).
//!
//! Zip-bomb guards: per-entry and total uncompressed caps.

use crate::core::geojson_io::GeoError;
use kml::types::Geometry as KmlGeometry;
use kml::Kml;
use std::io::{Cursor, Read};

/// Reject single entries larger than this once decompressed.
const MAX_ENTRY_BYTES: u64 = 100 * 1024 * 1024;
/// Reject archives whose total decompressed size exceeds this.
const MAX_TOTAL_BYTES: u64 = 500 * 1024 * 1024;

impl From<std::io::Error> for GeoError {
    fn from(e: std::io::Error) -> Self {
        GeoError(format!("io: {e}"))
    }
}

impl From<zip::result::ZipError> for GeoError {
    fn from(e: zip::result::ZipError) -> Self {
        GeoError(format!("zip: {e}"))
    }
}

impl From<kml::Error> for GeoError {
    fn from(e: kml::Error) -> Self {
        GeoError(format!("kml: {e}"))
    }
}

/// Parse KMZ (or raw KML) bytes into a GeoJSON FeatureCollection string.
pub fn kmz_to_geojson(bytes: &[u8]) -> Result<String, GeoError> {
    let kml_text = if bytes.starts_with(b"PK") {
        extract_doc_kml(bytes)?
    } else {
        String::from_utf8(bytes.to_vec())
            .map_err(|e| GeoError::new(format!("kml utf-8: {e}")))?
    };
    let root: Kml = kml_text
        .parse()
        .map_err(|e| GeoError::new(format!("kml parse: {e}")))?;

    let mut features: Vec<geojson::Feature> = Vec::new();
    walk(&root, &mut features)?;

    let fc = geojson::FeatureCollection {
        bbox: None,
        features,
        foreign_members: None,
    };
    Ok(fc.to_string())
}

/// Pull the primary KML document text out of a KMZ archive (prefers `doc.kml`).
fn extract_doc_kml(bytes: &[u8]) -> Result<String, GeoError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;

    // Pick the entry index: exact `doc.kml` (case-insensitive) wins; else first `*.kml`.
    let mut doc_idx: Option<usize> = None;
    let mut first_kml_idx: Option<usize> = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_ascii_lowercase();
        if name.contains("..") {
            return Err(GeoError::new("zip entry path traversal rejected"));
        }
        let base = name.rsplit('/').next().unwrap_or(&name);
        if base == "doc.kml" {
            doc_idx = Some(i);
            break;
        }
        if first_kml_idx.is_none() && base.ends_with(".kml") {
            first_kml_idx = Some(i);
        }
    }
    let idx = doc_idx
        .or(first_kml_idx)
        .ok_or_else(|| GeoError::new("no .kml entry found in KMZ"))?;

    // Guard total decompressed size across the archive.
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        total = total.saturating_add(archive.by_index(i)?.size());
    }
    if total > MAX_TOTAL_BYTES {
        return Err(GeoError::new("KMZ exceeds total decompressed size limit"));
    }

    let mut entry = archive.by_index(idx)?;
    if entry.size() > MAX_ENTRY_BYTES {
        return Err(GeoError::new("KMZ entry exceeds decompressed size limit"));
    }
    let mut text = String::with_capacity(entry.size() as usize);
    entry.read_to_string(&mut text)?;
    Ok(text)
}

/// Recursively collect Placemarks (and bare geometries) into GeoJSON features.
fn walk(node: &Kml, out: &mut Vec<geojson::Feature>) -> Result<(), GeoError> {
    match node {
        Kml::KmlDocument(doc) => {
            for el in &doc.elements {
                walk(el, out)?;
            }
        }
        Kml::Document { elements, .. } => {
            for el in elements {
                walk(el, out)?;
            }
        }
        Kml::Folder(folder) => {
            for el in &folder.elements {
                walk(el, out)?;
            }
        }
        Kml::Placemark(pm) => {
            if let Some(geom) = &pm.geometry {
                if let Some(feature) = feature_from_geometry(geom, pm.name.clone(), pm.description.clone())? {
                    out.push(feature);
                }
            }
        }
        // Bare geometry nodes (no enclosing placemark).
        Kml::Point(_) | Kml::LineString(_) | Kml::LinearRing(_) | Kml::Polygon(_)
        | Kml::MultiGeometry(_) => {
            if let Some(geom) = bare_geometry(node) {
                if let Some(feature) = feature_from_geometry(&geom, None, None)? {
                    out.push(feature);
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Wrap the bare-geometry Kml variants back into a `kml::types::Geometry` for conversion.
fn bare_geometry(node: &Kml) -> Option<KmlGeometry> {
    match node {
        Kml::Point(p) => Some(KmlGeometry::Point(p.clone())),
        Kml::LineString(l) => Some(KmlGeometry::LineString(l.clone())),
        Kml::LinearRing(l) => Some(KmlGeometry::LinearRing(l.clone())),
        Kml::Polygon(p) => Some(KmlGeometry::Polygon(p.clone())),
        Kml::MultiGeometry(m) => Some(KmlGeometry::MultiGeometry(m.clone())),
        _ => None,
    }
}

/// Convert one KML geometry (+ optional name/description) to a GeoJSON feature.
fn feature_from_geometry(
    geom: &KmlGeometry,
    name: Option<String>,
    description: Option<String>,
) -> Result<Option<geojson::Feature>, GeoError> {
    let geo: geo_types::Geometry<f64> = match geo_types::Geometry::try_from(geom.clone()) {
        Ok(g) => g,
        // Unsupported sub-geometries (e.g. bare LinearRing edge cases) are skipped, not fatal.
        Err(_) => return Ok(None),
    };
    let value = geojson::GeometryValue::from(&geo);
    let geometry = geojson::Geometry::new(value);

    let mut props = serde_json::Map::new();
    if let Some(n) = name {
        props.insert("name".into(), n.into());
    }
    if let Some(d) = description {
        props.insert("description".into(), d.into());
    }

    Ok(Some(geojson::Feature {
        bbox: None,
        geometry: Some(geometry),
        id: None,
        properties: Some(props),
        foreign_members: None,
    }))
}
