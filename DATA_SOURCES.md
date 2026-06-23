# Data Sources & Licensing

All data shipped in this demo is either **U.S. public-domain government data** or **generated**
by the build script.

The processed assets live in `apps/web/public/data/*.parquet` (geometry stored as WKB). Raw inputs
are downloaded to `data/raw/` by [`scripts/build_demo_db.py`](scripts/build_demo_db.py) and are **not**
committed. Re-create everything with:

```bash
pip install duckdb h3 requests
python scripts/build_demo_db.py --metro austin
```

## Facilities — `facility.parquet`

- **Source:** U.S. Energy Information Administration (EIA) / HIFLD **"Electric Power Transmission
  Lines"**, served from the public ArcGIS FeatureServer
  (`services1.arcgis.com/Hp6G80Pky0om7QvQ/.../Electric_Power_Transmission_Lines`).
- **License:** Public domain. The public layer's access restriction is *"None (Public Use)"*, and EIA
  characterizes the underlying HIFLD data it republishes as *"public domain information."* No
  attribution is required (courtesy credit only).
- **Note:** HIFLD's public "HIFLD Open" portal was discontinued in 2025; this layer remains publicly
  available via the EIA U.S. Energy Atlas and agency ArcGIS mirrors. There is **no** free public-domain
  U.S. fiber-route dataset, so real electric-transmission geometry stands in as the "utility facility"
  network. Owner names are **relabeled to fictional operators** (Operator Alpha–Epsilon) and the
  lifecycle `status` is **fabricated**; the geometry and voltage class are the real public values.

## Jurisdiction — `county.parquet`

- **Source:** U.S. Census Bureau **TIGER/Line cartographic-boundary counties**, 2024 1:500k
  (`www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip`).
- **License:** Public domain (U.S. Government Work; data.gov lists it CC0 1.0). No attribution required.
- **Scope:** Subset to the demo metro's counties (default Austin, TX: Travis 48453, Williamson 48491,
  Hays 48209).

## Tickets & AOIs — `ticket.parquet`, `aoi.parquet`

- **Fully fabricated** by the build script. Work points are sampled on/near the public transmission
  lines, given synthetic ids/sources/statuses/dates, buffered into AOI polygons (geodesic meters via a
  UTM round-trip), and conflict-scored by a generic owner/status rule. No real permit, ticket, or
  customer data is used. The conflict rule lives in [`data/demo_config.json`](data/demo_config.json).

## Libraries / specifications

- **H3** geospatial index (Uber) — indices computed with the pure-Rust [`h3o`](https://crates.io/crates/h3o)
  crate (in the geo engine) and the `h3` Python binding (at build time); both share H3's index space.
- Geometry/geodesy via [`geo`](https://crates.io/crates/geo), [`proj4rs`](https://crates.io/crates/proj4rs),
  [`geographiclib-rs`](https://crates.io/crates/geographiclib-rs); query engine
  [DuckDB](https://duckdb.org) + its Spatial extension.
