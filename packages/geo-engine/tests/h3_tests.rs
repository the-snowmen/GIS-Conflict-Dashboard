//! H3 unit + golden parity tests (run natively).

use geokit::core::h3::{hex_density, index_point, multi_res, polyfill_geojson};

/// Golden parity: h3o must produce the exact same 64-bit index as the H3 reference C library
/// for the canonical San Francisco example (`latLngToCell(37.7759..., -122.4179..., 9)`).
#[test]
fn h3o_matches_reference_index() {
    let cell = index_point(37.775938728915946, -122.41795063018799, 9).unwrap();
    assert_eq!(cell.to_string(), "8928308280fffff");
}

#[test]
fn multi_res_indexes_all_four_resolutions() {
    let m = multi_res(30.2672, -97.7431).unwrap();
    for s in [&m.res5, &m.res6, &m.res7, &m.res8] {
        assert!(!s.is_empty());
        // each parses back to a valid cell
        assert!(s.parse::<h3o::CellIndex>().is_ok());
    }
    // resolutions are distinct cells
    assert_ne!(m.res5, m.res8);
}

#[test]
fn density_counts_every_point() {
    let pts = vec![
        (-97.7431, 30.2672),
        (-97.7432, 30.2673), // same neighborhood -> likely same res-8 hex
        (-97.9000, 30.4000), // far away -> different hex
    ];
    let bins = hex_density(pts.clone(), 8).unwrap();
    let total: u32 = bins.iter().map(|b| b.count).sum();
    assert_eq!(total, pts.len() as u32, "every point must be counted once");
    assert!(bins.len() >= 2, "distant points must land in different hexes");
    // output is sorted by h3 index (deterministic)
    let mut sorted = bins.clone();
    sorted.sort_by(|a, b| a.h3.cmp(&b.h3));
    assert_eq!(bins, sorted);
}

#[test]
fn polyfill_covers_polygon() {
    let poly = r#"{"type":"Polygon","coordinates":[[[-97.75,30.26],[-97.74,30.26],[-97.74,30.27],[-97.75,30.27],[-97.75,30.26]]]}"#;
    let cells = polyfill_geojson(poly, 9).unwrap();
    assert!(!cells.is_empty(), "polyfill must cover a non-trivial polygon");
    for c in &cells {
        assert!(c.parse::<h3o::CellIndex>().is_ok());
    }
}

#[test]
fn invalid_resolution_errors() {
    assert!(index_point(30.0, -97.0, 99).is_err());
}
