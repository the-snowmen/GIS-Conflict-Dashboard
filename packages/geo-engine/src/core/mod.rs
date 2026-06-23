//! Pure-Rust geo core. No `wasm_bindgen` here so the host target can test/bench it directly.

pub mod buffer;
pub mod h3;
pub mod kmz;

mod geojson_io;

pub use geojson_io::{geometry_from_geojson, geometry_to_geojson, GeoError};
