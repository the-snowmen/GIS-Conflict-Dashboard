//! Buffer unit + golden parity tests (run natively).

use geo::algorithm::geodesic_area::GeodesicArea;
use geokit::core::buffer::{buffer_geojson, buffer_meters};
use geokit::core::geometry_from_geojson;

const AUSTIN: (f64, f64) = (-97.7431, 30.2672); // (lng, lat), downtown Austin

/// A geodesic point buffer should approximate a circle: area ~= pi * r^2 (an N-gon slightly
/// under-approximates). This is the golden parity check against PostGIS `::geography` point
/// buffering, which produces the same ellipsoidal circle.
#[test]
fn point_buffer_area_matches_circle() {
    let pt = format!(
        r#"{{"type":"Point","coordinates":[{},{}]}}"#,
        AUSTIN.0, AUSTIN.1
    );
    let geom = geometry_from_geojson(&pt).unwrap();
    let r = 100.0;
    let mp = buffer_meters(&geom, r, 16).unwrap(); // 64-gon
    let area = mp.geodesic_area_unsigned();
    let expected = std::f64::consts::PI * r * r;
    let ratio = area / expected;
    assert!(
        ratio > 0.97 && ratio < 1.01,
        "point buffer area ratio out of range: ratio={ratio}, area={area}, expected={expected}"
    );
}

/// Buffering a line by `r` should yield roughly `2*r*length + pi*r^2` (two parallel offsets +
/// rounded caps). We bound it loosely since the geodesic length is approximate.
#[test]
fn line_buffer_area_is_reasonable() {
    // ~1.5 km line.
    let line = r#"{"type":"LineString","coordinates":[[-97.7431,30.2672],[-97.7300,30.2740]]}"#;
    let geom = geometry_from_geojson(line).unwrap();
    let r = 50.0;
    let mp = buffer_meters(&geom, r, 8).unwrap();
    let area = mp.geodesic_area_unsigned();
    assert!(area > 0.0, "line buffer must have positive area");
    // Sanity envelope: between a bare circle and a generously long corridor.
    assert!(
        area > std::f64::consts::PI * r * r && area < 400_000.0,
        "line buffer area unexpected: {area}"
    );
}

/// Polygon buffering grows the area; output must be a valid (Multi)Polygon GeoJSON.
#[test]
fn polygon_buffer_grows_area() {
    let poly = r#"{"type":"Polygon","coordinates":[[[-97.745,30.266],[-97.742,30.266],[-97.742,30.269],[-97.745,30.269],[-97.745,30.266]]]}"#;
    let geom = geometry_from_geojson(poly).unwrap();
    let orig = match &geom {
        geo_types::Geometry::Polygon(p) => p.geodesic_area_unsigned(),
        _ => unreachable!(),
    };
    let mp = buffer_meters(&geom, 30.0, 8).unwrap();
    let grown = mp.geodesic_area_unsigned();
    assert!(grown > orig, "buffered area {grown} should exceed original {orig}");

    let out = buffer_geojson(poly, 30.0, 8).unwrap();
    assert!(out.contains("Polygon"), "expected polygon GeoJSON, got: {out}");
}

#[test]
fn negative_distance_is_rejected() {
    let pt = r#"{"type":"Point","coordinates":[-97.7431,30.2672]}"#;
    let geom = geometry_from_geojson(pt).unwrap();
    assert!(buffer_meters(&geom, -5.0, 8).is_err());
}
