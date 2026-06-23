//! KMZ/KML import tests (run natively).

use geokit::core::kmz::kmz_to_geojson;
use std::io::{Cursor, Write};

const KML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark>
    <name>Test Point</name>
    <description>a sample point</description>
    <Point><coordinates>-97.7431,30.2672,0</coordinates></Point>
  </Placemark>
  <Folder>
    <Placemark>
      <name>Test Line</name>
      <LineString><coordinates>-97.74,30.26,0 -97.73,30.27,0</coordinates></LineString>
    </Placemark>
  </Folder>
</Document></kml>"#;

fn zip_kmz(kml: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut zw = zip::ZipWriter::new(Cursor::new(&mut buf));
        zw.start_file("doc.kml", zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(kml.as_bytes()).unwrap();
        zw.finish().unwrap();
    }
    buf
}

fn feature_count_and_first_name(geojson: &str) -> (usize, Option<String>) {
    let v: serde_json::Value = serde_json::from_str(geojson).unwrap();
    let feats = v["features"].as_array().unwrap();
    let name = feats
        .first()
        .and_then(|f| f["properties"]["name"].as_str())
        .map(|s| s.to_string());
    (feats.len(), name)
}

#[test]
fn parses_kmz_archive() {
    let bytes = zip_kmz(KML);
    let geojson = kmz_to_geojson(&bytes).unwrap();
    let (count, first_name) = feature_count_and_first_name(&geojson);
    assert_eq!(count, 2, "expected point + line features, got {count}");
    assert_eq!(first_name.as_deref(), Some("Test Point"));
    assert!(geojson.contains("LineString"));
}

#[test]
fn parses_raw_kml_bytes() {
    // No PK magic -> treated as raw KML text.
    let geojson = kmz_to_geojson(KML.as_bytes()).unwrap();
    let (count, _) = feature_count_and_first_name(&geojson);
    assert_eq!(count, 2);
}

#[test]
fn rejects_non_kml_garbage() {
    assert!(kmz_to_geojson(&[0xFF, 0xFE, 0x00, 0x01]).is_err());
}
