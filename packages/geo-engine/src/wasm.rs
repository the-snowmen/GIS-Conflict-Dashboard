//! `wasm-bindgen` shims (compiled only for `wasm32`). Thin wrappers over `core::*` so the
//! native test/bench builds never link the wasm-import layer. Geometry crosses the boundary
//! as GeoJSON strings (debuggable, directly consumable by MapLibre/deck.gl); small typed
//! results use `serde-wasm-bindgen`.

use crate::core::{buffer, h3, kmz, GeoError};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

fn js_err(e: GeoError) -> JsValue {
    JsValue::from_str(&e.0)
}

fn ser_err(e: serde_wasm_bindgen::Error) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Geodesic buffer (meters) of a GeoJSON geometry -> GeoJSON MultiPolygon string.
#[wasm_bindgen]
pub fn buffer_geojson(geojson: &str, meters: f64, quad_segments: u32) -> Result<String, JsValue> {
    buffer::buffer_geojson(geojson, meters, quad_segments.max(1) as usize).map_err(js_err)
}

/// H3 index of a point at `res` (hex string).
#[wasm_bindgen]
pub fn h3_index_point(lat: f64, lng: f64, res: u8) -> Result<String, JsValue> {
    h3::index_point(lat, lng, res)
        .map(|c| c.to_string())
        .map_err(js_err)
}

/// H3 index of a point at res 5/6/7/8 -> `{ res5, res6, res7, res8 }`.
#[wasm_bindgen]
pub fn h3_multi_res(lat: f64, lng: f64) -> Result<JsValue, JsValue> {
    let m = h3::multi_res(lat, lng).map_err(js_err)?;
    serde_wasm_bindgen::to_value(&m).map_err(ser_err)
}

/// H3 cell boundary -> GeoJSON Polygon string.
#[wasm_bindgen]
pub fn h3_cell_boundary_geojson(h3_index: &str) -> Result<String, JsValue> {
    h3::cell_boundary_geojson(h3_index).map_err(js_err)
}

/// Aggregate `[lng, lat]` points into a per-hex density FeatureCollection (GeoJSON string).
#[wasm_bindgen]
pub fn h3_hex_density_geojson(points: JsValue, res: u8) -> Result<String, JsValue> {
    let pts: Vec<[f64; 2]> = serde_wasm_bindgen::from_value(points).map_err(ser_err)?;
    h3::hex_density_geojson(pts.into_iter().map(|p| (p[0], p[1])), res).map_err(js_err)
}

/// Cover a GeoJSON polygon with H3 cells at `res` -> array of hex strings.
#[wasm_bindgen]
pub fn h3_polyfill(geojson_polygon: &str, res: u8) -> Result<JsValue, JsValue> {
    let cells = h3::polyfill_geojson(geojson_polygon, res).map_err(js_err)?;
    serde_wasm_bindgen::to_value(&cells).map_err(ser_err)
}

/// Parse KMZ (or raw KML) bytes -> GeoJSON FeatureCollection string.
#[wasm_bindgen]
pub fn kmz_to_geojson(bytes: &[u8]) -> Result<String, JsValue> {
    kmz::kmz_to_geojson(bytes).map_err(js_err)
}
