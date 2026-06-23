//! GeoJSON <-> `geo_types` conversion helpers shared by the buffer/h3/kmz modules.

use geo_types::Geometry;
use std::fmt;

/// Lightweight error type so the core stays dependency-light (no `thiserror`) and the wasm
/// shim can surface a plain string to JS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeoError(pub String);

impl GeoError {
    pub fn new(msg: impl Into<String>) -> Self {
        GeoError(msg.into())
    }
}

impl fmt::Display for GeoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for GeoError {}

impl From<serde_json::Error> for GeoError {
    fn from(e: serde_json::Error) -> Self {
        GeoError(format!("json: {e}"))
    }
}

impl From<geojson::Error> for GeoError {
    fn from(e: geojson::Error) -> Self {
        GeoError(format!("geojson: {e}"))
    }
}

/// Parse a single GeoJSON geometry object (the `{ "type": ..., "coordinates": ... }` form)
/// into a `geo_types` geometry.
pub fn geometry_from_geojson(s: &str) -> Result<Geometry<f64>, GeoError> {
    let gj: geojson::Geometry = s.parse()?;
    let geom: Geometry<f64> = Geometry::try_from(gj)?;
    Ok(geom)
}

/// Serialize a `geo_types` geometry back to a GeoJSON geometry string.
pub fn geometry_to_geojson(geom: &Geometry<f64>) -> String {
    let value = geojson::GeometryValue::from(geom);
    geojson::Geometry::new(value).to_string()
}
