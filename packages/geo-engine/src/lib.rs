//! geokit — WASM geo engine for the GIS Conflict Dashboard demo.
//!
//! Pure-Rust geometry/geodesy lives in [`core`] and is unit/golden/bench-testable on the
//! host target. The `wasm` module (compiled only for `wasm32`) is a thin `wasm-bindgen`
//! shim over `core::*`, so `cargo test`/`cargo bench` link without the wasm-import layer.

pub mod core;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
