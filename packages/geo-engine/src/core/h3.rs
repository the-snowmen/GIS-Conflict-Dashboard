//! H3 indexing, hex-density aggregation, and polygon fill — pure-Rust via `h3o`.
//!
//! A single H3 toolkit covering what the demo needs, replacing both `h3-js` on the client
//! and server-side H3 aggregation:
//!   * multi-resolution point indexing (res 5-8; res 6 is the heatmap default),
//!   * `cell -> boundary` for rendering,
//!   * `points -> per-hex density` for the heatmap,
//!   * `polygon -> covering cells` (polyfill) for route/AOI coverage.
//!
//! `h3o` shares H3's exact 64-bit index space, so indices are interoperable with `h3-js`.

use crate::core::geojson_io::GeoError;
use geo_types::{Coord, LineString, Polygon};
use h3o::{geom::TilerBuilder, CellIndex, LatLng, Resolution};
use serde::Serialize;
use std::collections::HashMap;

/// Resolutions the demo indexes for every ticket (the `h3_res5..8` columns).
pub const INDEXED_RESOLUTIONS: [u8; 4] = [5, 6, 7, 8];
/// Default resolution for density heatmaps.
pub const DEFAULT_DENSITY_RES: u8 = 6;

/// H3 index of a point at all of [`INDEXED_RESOLUTIONS`], as hex strings.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MultiResIndex {
    pub res5: String,
    pub res6: String,
    pub res7: String,
    pub res8: String,
}

/// One aggregated hex cell for a density heatmap (count + cell center).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HexBin {
    pub h3: String,
    pub count: u32,
    pub center_lat: f64,
    pub center_lng: f64,
}

fn resolution(res: u8) -> Result<Resolution, GeoError> {
    Resolution::try_from(res).map_err(|_| GeoError::new(format!("invalid H3 resolution: {res}")))
}

/// Index a single (lat, lng) point at `res`.
pub fn index_point(lat: f64, lng: f64, res: u8) -> Result<CellIndex, GeoError> {
    let ll = LatLng::new(lat, lng).map_err(|e| GeoError::new(format!("latlng: {e}")))?;
    Ok(ll.to_cell(resolution(res)?))
}

/// Index a point at res 5/6/7/8 at once (for ticket `h3_res5..8` columns).
pub fn multi_res(lat: f64, lng: f64) -> Result<MultiResIndex, GeoError> {
    let ll = LatLng::new(lat, lng).map_err(|e| GeoError::new(format!("latlng: {e}")))?;
    Ok(MultiResIndex {
        res5: ll.to_cell(Resolution::Five).to_string(),
        res6: ll.to_cell(Resolution::Six).to_string(),
        res7: ll.to_cell(Resolution::Seven).to_string(),
        res8: ll.to_cell(Resolution::Eight).to_string(),
    })
}

/// Parse a hex H3 index string into a `CellIndex`.
pub fn parse_cell(h3: &str) -> Result<CellIndex, GeoError> {
    h3.parse::<CellIndex>()
        .map_err(|e| GeoError::new(format!("invalid H3 index '{h3}': {e}")))
}

/// Closed lon/lat ring (GeoJSON winding) of a cell's boundary.
pub fn cell_boundary_ring(cell: CellIndex) -> Vec<[f64; 2]> {
    let boundary = cell.boundary();
    let mut ring: Vec<[f64; 2]> = boundary.iter().map(|ll| [ll.lng(), ll.lat()]).collect();
    if let Some(first) = ring.first().copied() {
        ring.push(first);
    }
    ring
}

/// A cell's boundary as a `geo_types` Polygon (closed ring, no holes).
pub fn cell_boundary_polygon(cell: CellIndex) -> Polygon<f64> {
    let coords: Vec<Coord<f64>> = cell_boundary_ring(cell)
        .into_iter()
        .map(|c| Coord { x: c[0], y: c[1] })
        .collect();
    Polygon::new(LineString::new(coords), vec![])
}

/// Cell boundary as a GeoJSON Polygon geometry string.
pub fn cell_boundary_geojson(h3: &str) -> Result<String, GeoError> {
    let cell = parse_cell(h3)?;
    let geom = geo_types::Geometry::Polygon(cell_boundary_polygon(cell));
    Ok(crate::core::geometry_to_geojson(&geom))
}

/// Aggregate (lng, lat) points into per-hex counts at `res`.
///
/// `points` are `(lng, lat)` to match GeoJSON x/y order.
pub fn hex_density<I>(points: I, res: u8) -> Result<Vec<HexBin>, GeoError>
where
    I: IntoIterator<Item = (f64, f64)>,
{
    let r = resolution(res)?;
    let mut counts: HashMap<CellIndex, u32> = HashMap::new();
    for (lng, lat) in points {
        let ll = LatLng::new(lat, lng).map_err(|e| GeoError::new(format!("latlng: {e}")))?;
        *counts.entry(ll.to_cell(r)).or_insert(0) += 1;
    }
    let mut bins: Vec<HexBin> = counts
        .into_iter()
        .map(|(cell, count)| {
            let center: LatLng = cell.into();
            HexBin {
                h3: cell.to_string(),
                count,
                center_lat: center.lat(),
                center_lng: center.lng(),
            }
        })
        .collect();
    // Deterministic ordering (helps golden tests + stable rendering).
    bins.sort_by(|a, b| a.h3.cmp(&b.h3));
    Ok(bins)
}

/// Density as a GeoJSON FeatureCollection of hex polygons (ready for a choropleth layer).
pub fn hex_density_geojson<I>(points: I, res: u8) -> Result<String, GeoError>
where
    I: IntoIterator<Item = (f64, f64)>,
{
    let bins = hex_density(points, res)?;
    let features: Vec<geojson::Feature> = bins
        .into_iter()
        .map(|bin| {
            let cell = bin.h3.parse::<CellIndex>().expect("just-produced cell parses");
            let geom = geo_types::Geometry::Polygon(cell_boundary_polygon(cell));
            let geometry = geojson::Geometry::new(geojson::GeometryValue::from(&geom));
            let mut props = serde_json::Map::new();
            props.insert("h3".into(), bin.h3.into());
            props.insert("count".into(), bin.count.into());
            geojson::Feature {
                bbox: None,
                geometry: Some(geometry),
                id: None,
                properties: Some(props),
                foreign_members: None,
            }
        })
        .collect();
    let fc = geojson::FeatureCollection {
        bbox: None,
        features,
        foreign_members: None,
    };
    Ok(fc.to_string())
}

/// Cover a GeoJSON polygon with H3 cells at `res` (polyfill). Returns hex index strings.
pub fn polyfill_geojson(geojson_polygon: &str, res: u8) -> Result<Vec<String>, GeoError> {
    let geom = crate::core::geometry_from_geojson(geojson_polygon)?;
    let polygons = collect_polygons(&geom)?;
    let mut tiler = TilerBuilder::new(resolution(res)?).build();
    for poly in polygons {
        tiler
            .add(poly)
            .map_err(|e| GeoError::new(format!("polyfill add: {e}")))?;
    }
    Ok(tiler.into_coverage().map(|c| c.to_string()).collect())
}

/// Extract `geo_types::Polygon`s from a geometry (Polygon or MultiPolygon).
fn collect_polygons(geom: &geo_types::Geometry<f64>) -> Result<Vec<Polygon<f64>>, GeoError> {
    match geom {
        geo_types::Geometry::Polygon(p) => Ok(vec![p.clone()]),
        geo_types::Geometry::MultiPolygon(mp) => Ok(mp.0.clone()),
        _ => Err(GeoError::new("polyfill requires a Polygon or MultiPolygon")),
    }
}
