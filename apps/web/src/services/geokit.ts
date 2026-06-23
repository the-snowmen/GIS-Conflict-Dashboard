// geokit = our Rust->WASM geo engine (geodesic buffer, H3, KMZ). Built with
// `wasm-pack --target bundler`, so vite-plugin-wasm + top-level-await instantiate the module
// at import time; functions are ready once this module's import resolves.
import * as geokit from "geokit";

export type Geokit = typeof geokit;

if (import.meta.env.DEV) {
  (window as unknown as { __geokit?: Geokit }).__geokit = geokit;
}

export function getGeokit(): Geokit {
  return geokit;
}
