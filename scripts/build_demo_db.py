#!/usr/bin/env python3
"""
build_demo_db.py — produce the static GeoParquet assets for the GIS Conflict Dashboard demo.

Public-data pipeline (see DATA_SOURCES.md):
  * Facilities  <- EIA/HIFLD "Electric Power Transmission Lines" (public domain), bbox-clipped
                   to a metro and relabeled with NEUTRAL fictional operators.
  * Jurisdiction<- US Census TIGER cartographic-boundary counties (public domain).
  * Tickets/AOIs<- FABRICATED here: work points sampled near facilities, buffered into AOIs,
                   conflict-scored by a generic, config-driven owner/status rule.

DuckDB-Spatial does all geometry work (the same spatial SQL the browser will run); Python
handles ArcGIS paging, sampling, and H3 precompute. Output: one Parquet per table with the
geometry stored as WKB (version-stable; the browser does ST_GeomFromWKB).

Usage:  python scripts/build_demo_db.py [--metro austin] [--tickets 600] [--force]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

import duckdb
import h3
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "apps" / "web" / "public" / "data"

# ArcGIS FeatureServer for the public-domain HIFLD/EIA transmission lines (probed live).
TRANSMISSION_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Electric_Power_Transmission_Lines/FeatureServer/0/query"
)
COUNTY_ZIP_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip"
COUNTY_SHP_IN_ZIP = "cb_2024_us_county_500k.shp"

NEUTRAL_OPERATORS = [
    "Operator Alpha",
    "Operator Beta",
    "Operator Gamma",
    "Operator Delta",
    "Operator Epsilon",
]
SELF_OPERATOR = "Operator Alpha"          # "ours" in the generic conflict rule
EXCLUDED_FACILITY_STATUSES = ["retired"]  # lifecycle states skipped when conflict-scoring
TICKET_SOURCES = ["811_locate", "permit", "design_review", "field_survey"]

METROS = {
    "austin": {
        "label": "Austin, TX",
        "state": "TX",
        "state_fips": "48",
        "counties": {"48453": "Travis", "48491": "Williamson", "48209": "Hays"},
        # minx, miny, maxx, maxy (lon/lat) covering the three counties.
        "bbox": (-98.30, 29.85, -97.35, 30.95),
        "utm_epsg": 32614,  # UTM zone 14N
    }
}


def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


# --------------------------------------------------------------------------- downloads
def download_transmission(bbox, dest: Path, force: bool) -> None:
    if dest.exists() and not force:
        log(f"transmission cache hit: {dest.name}")
        return
    minx, miny, maxx, maxy = bbox
    page = 2000
    offset = 0
    features = []
    log("downloading transmission lines (ArcGIS, paged)...")
    while True:
        params = {
            "where": "1=1",
            "geometry": f"{minx},{miny},{maxx},{maxy}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "outSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "OWNER,VOLTAGE,VOLT_CLASS,STATUS,TYPE",
            "returnGeometry": "true",
            "resultOffset": offset,
            "resultRecordCount": page,
            "f": "geojson",
        }
        r = requests.get(TRANSMISSION_URL, params=params, timeout=90)
        r.raise_for_status()
        data = r.json()
        batch = data.get("features", [])
        features.extend(batch)
        log(f"  +{len(batch)} (total {len(features)})")
        if len(batch) < page:
            break
        offset += page
    fc = {"type": "FeatureCollection", "features": features}
    dest.write_text(json.dumps(fc))
    log(f"wrote {dest.name} ({len(features)} features)")


def download_counties(dest: Path, force: bool) -> None:
    if dest.exists() and not force:
        log(f"county cache hit: {dest.name}")
        return
    log("downloading Census cartographic-boundary counties...")
    with requests.get(COUNTY_ZIP_URL, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 16):
                f.write(chunk)
    log(f"wrote {dest.name} ({dest.stat().st_size // 1024} KB)")


# --------------------------------------------------------------------------- build
def meters_to_deg(dx_m: float, dy_m: float, lat: float):
    """Approximate local meter offset -> degree offset at latitude `lat`."""
    dlat = dy_m / 111_320.0
    dlon = dx_m / (111_320.0 * math.cos(math.radians(lat)))
    return dlon, dlat


def fabricate_tickets(con, metro: dict, n: int, rng: random.Random):
    """Sample work points ON eligible facilities (+ a few far) and precompute H3 indices."""
    # Points that lie ON the eligible transmission lines (3 fractions each) so a small AOI
    # buffer actually intersects the line. Centroids of lines often fall off the line.
    on_line = con.execute(
        """
        SELECT ST_X(p) AS lon, ST_Y(p) AS lat FROM (
          SELECT ST_LineInterpolatePoint(ST_LineMerge(geom), frac) AS p
          FROM facility, (SELECT unnest([0.2, 0.5, 0.8]) AS frac)
          WHERE owner = ? AND status NOT IN ('retired')
            AND ST_GeometryType(ST_LineMerge(geom)) = 'LINESTRING'
        )
        """,
        [SELF_OPERATOR],
    ).fetchall()
    if not on_line:
        raise RuntimeError("no eligible facilities to sample tickets near")

    minx, miny, maxx, maxy = metro["bbox"]
    start = date.today() - timedelta(days=730)
    rows = []
    for i in range(n):
        if rng.random() < 0.78:
            # on/near an eligible facility line -> likely to conflict
            base_lon, base_lat = rng.choice(on_line)
            dx = rng.gauss(0, 60.0)
            dy = rng.gauss(0, 60.0)
            dlon, dlat = meters_to_deg(dx, dy, base_lat)
            lon, lat = base_lon + dlon, base_lat + dlat
        else:
            # scattered in the metro -> likely clear
            lon = rng.uniform(minx, maxx)
            lat = rng.uniform(miny, maxy)
        ticket_id = f"AUS-{100001 + i}"
        source = rng.choice(TICKET_SOURCES)
        created = start + timedelta(days=rng.randint(0, 730))
        buffer_m = rng.choice([25, 50, 75, 100, 150])
        rows.append(
            (
                ticket_id,
                source,
                created.isoformat(),
                float(lon),
                float(lat),
                int(buffer_m),
                h3.latlng_to_cell(lat, lon, 5),
                h3.latlng_to_cell(lat, lon, 6),
                h3.latlng_to_cell(lat, lon, 7),
                h3.latlng_to_cell(lat, lon, 8),
            )
        )

    con.execute(
        """CREATE OR REPLACE TABLE ticket_seed (
              ticket_id VARCHAR, source VARCHAR, created_at DATE,
              lon DOUBLE, lat DOUBLE, buffer_m INTEGER,
              h3_res5 VARCHAR, h3_res6 VARCHAR, h3_res7 VARCHAR, h3_res8 VARCHAR)"""
    )
    con.executemany(
        "INSERT INTO ticket_seed VALUES (?,?,?,?,?,?,?,?,?,?)", rows
    )
    log(f"fabricated {len(rows)} tickets")


def build(metro_key: str, n_tickets: int, force: bool) -> None:
    metro = METROS[metro_key]
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    transmission_geojson = RAW / f"transmission_{metro_key}.geojson"
    county_zip = RAW / "cb_2024_us_county_500k.zip"
    download_transmission(metro["bbox"], transmission_geojson, force)
    download_counties(county_zip, force)

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SELECT setseed(0.42)")
    utm = f"EPSG:{metro['utm_epsg']}"

    # --- facilities: neutral operator + fabricated status, real voltage class/geometry ---
    log("building facility table...")
    con.execute(
        """
        CREATE TABLE facility AS
        WITH src AS (
          SELECT NULLIF(CAST(VOLT_CLASS AS VARCHAR), '') AS volt_class,
                 ST_Force2D(geom) AS geom,
                 random() AS r_status,
                 random() AS r_owner
          FROM ST_Read(?)
          WHERE geom IS NOT NULL
        )
        SELECT row_number() OVER () AS id,
               'transmission_line' AS kind,
               -- weighted neutral operator: ~35% is "ours" (Operator Alpha) so conflicts are common
               CASE WHEN r_owner < 0.35 THEN 'Operator Alpha'
                    WHEN r_owner < 0.55 THEN 'Operator Beta'
                    WHEN r_owner < 0.72 THEN 'Operator Gamma'
                    WHEN r_owner < 0.87 THEN 'Operator Delta'
                    ELSE 'Operator Epsilon' END AS owner,
               COALESCE(volt_class, 'UNKNOWN') AS voltage_class,
               CASE WHEN r_status < 0.82 THEN 'in_service'
                    WHEN r_status < 0.93 THEN 'planned'
                    ELSE 'retired' END AS status,
               geom
        FROM src
        """,
        [str(transmission_geojson)],
    )
    fac_n = con.execute("SELECT count(*) FROM facility").fetchone()[0]
    log(f"  facilities: {fac_n}")

    # --- counties (jurisdiction) ---
    log("building county table...")
    fips = list(metro["counties"].keys())
    placeholders = ",".join("?" for _ in fips)
    con.execute(
        f"""
        CREATE TABLE county AS
        SELECT GEOID AS geoid, NAME AS name, ? AS state, ST_Force2D(geom) AS geom
        FROM ST_Read(?)
        WHERE GEOID IN ({placeholders})
        """,
        [metro["state"], f"/vsizip/{county_zip}/{COUNTY_SHP_IN_ZIP}", *fips],
    )
    cty_n = con.execute("SELECT count(*) FROM county").fetchone()[0]
    log(f"  counties: {cty_n}")

    # --- tickets (fabricated) + AOIs + conflict scoring ---
    fabricate_tickets(con, metro, n_tickets, random.Random(7))

    con.execute(
        f"""
        CREATE TABLE ticket_base AS
        SELECT s.*, ST_Point(s.lon, s.lat) AS geom,
               c.geoid AS county_geoid
        FROM ticket_seed s
        LEFT JOIN county c ON ST_Within(ST_Point(s.lon, s.lat), c.geom)
        """
    )

    con.execute(
        f"""
        CREATE TABLE aoi AS
        SELECT row_number() OVER () AS id, ticket_id,
               -- always_xy:=true keeps lon/lat order through the projected meter buffer
               ST_Transform(
                 ST_Buffer(ST_Transform(geom, 'EPSG:4326', '{utm}', always_xy := true), buffer_m),
                 '{utm}', 'EPSG:4326', always_xy := true) AS geom,
               buffer_m
        FROM ticket_base
        """
    )

    # generic, config-driven conflict rule: only "our" in-service facilities count
    excl = ",".join(f"'{s}'" for s in EXCLUDED_FACILITY_STATUSES)
    con.execute(
        f"""
        CREATE TABLE conflict AS
        SELECT a.ticket_id, COUNT(*) AS conflict_count
        FROM aoi a
        JOIN facility f ON ST_Intersects(a.geom, f.geom)
        WHERE f.owner = '{SELF_OPERATOR}'
          AND f.status NOT IN ({excl})
        GROUP BY a.ticket_id
        """
    )

    con.execute(
        """
        CREATE TABLE ticket AS
        SELECT b.ticket_id, b.source,
               COALESCE(cf.conflict_count, 0) AS conflict_count,
               CASE WHEN COALESCE(cf.conflict_count,0) > 0 THEN 'potential_conflict'
                    ELSE 'no_conflict' END AS status,
               b.created_at, b.lon, b.lat,
               b.h3_res5, b.h3_res6, b.h3_res7, b.h3_res8,
               b.county_geoid, ? AS state,
               b.geom
        FROM ticket_base b
        LEFT JOIN conflict cf ON b.ticket_id = cf.ticket_id
        """,
        [metro["state"]],
    )
    conflicts = con.execute(
        "SELECT count(*) FILTER (WHERE conflict_count > 0), count(*) FROM ticket"
    ).fetchone()
    log(f"  tickets: {conflicts[1]} ({conflicts[0]} with conflicts)")

    # --- export GeoParquet (geometry as WKB; browser does ST_GeomFromWKB) ---
    log("writing parquet assets...")
    exports = {
        "facility": "SELECT id, kind, owner, voltage_class, status, ST_AsWKB(geom) AS geom FROM facility",
        "county": "SELECT geoid, name, state, ST_AsWKB(geom) AS geom FROM county",
        "ticket": (
            "SELECT ticket_id, source, status, conflict_count, created_at, lon, lat, "
            "h3_res5, h3_res6, h3_res7, h3_res8, county_geoid, state, "
            "ST_AsWKB(geom) AS geom FROM ticket"
        ),
        "aoi": "SELECT id, ticket_id, buffer_m, ST_AsWKB(geom) AS geom FROM aoi",
    }
    for name, sql in exports.items():
        path = OUT / f"{name}.parquet"
        con.execute(f"COPY ({sql}) TO '{path}' (FORMAT PARQUET)")
        rows = con.execute(f"SELECT count(*) FROM read_parquet('{path}')").fetchone()[0]
        log(f"  {name}.parquet: {rows} rows ({path.stat().st_size // 1024} KB)")

    write_config(metro_key, metro)
    log("done.")


def write_config(metro_key: str, metro: dict) -> None:
    """Neutral, config-driven conflict rule (owner/status gating)."""
    cfg = {
        "metro": metro_key,
        "label": metro["label"],
        "selfOwners": [SELF_OPERATOR],
        "excludedFacilityStatuses": EXCLUDED_FACILITY_STATUSES,
        "ticketStatuses": ["potential_conflict", "no_conflict"],
        "note": "Generic owner/status gating expressed as a SQL WHERE clause at query time.",
    }
    text = json.dumps(cfg, indent=2) + "\n"
    (ROOT / "data" / "demo_config.json").write_text(text)
    (OUT / "demo_config.json").write_text(text)  # served to the web app
    log("wrote data/demo_config.json + apps/web/public/data/demo_config.json")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build demo GeoParquet assets.")
    ap.add_argument("--metro", default="austin", choices=sorted(METROS))
    ap.add_argument("--tickets", type=int, default=600)
    ap.add_argument("--force", action="store_true", help="re-download raw inputs")
    args = ap.parse_args(argv)
    build(args.metro, args.tickets, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
