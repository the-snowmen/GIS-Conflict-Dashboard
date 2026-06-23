//! Criterion benches for the geo core (run natively: `cargo bench`).

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use geokit::core::{buffer, h3};

fn sample_line() -> String {
    // ~1 km diagonal near downtown Austin, TX.
    r#"{"type":"LineString","coordinates":[[-97.7431,30.2672],[-97.7400,30.2700],[-97.7360,30.2740]]}"#
        .to_string()
}

fn bench_buffer(c: &mut Criterion) {
    let line = sample_line();
    c.bench_function("buffer_line_50m", |b| {
        b.iter(|| buffer::buffer_geojson(black_box(&line), black_box(50.0), 8).unwrap())
    });
}

fn bench_h3_density(c: &mut Criterion) {
    // Grid of points around Austin.
    let pts: Vec<(f64, f64)> = (0..2000)
        .map(|i| {
            let f = i as f64;
            (-97.80 + (f % 50.0) * 0.002, 30.20 + (f / 50.0) * 0.002)
        })
        .collect();
    c.bench_function("h3_density_res8_2k", |b| {
        b.iter(|| h3::hex_density(black_box(pts.clone()), 8).unwrap())
    });
}

criterion_group!(benches, bench_buffer, bench_h3_density);
criterion_main!(benches);
