//! Geodesic buffering in **meters**, aiming for parity with PostGIS
//! `ST_Buffer(geom::geography, meters)`.
//!
//! Strategy (see plan): there is no single pure-Rust "geography buffer", so we compose
//! mature crates:
//!   * **Points / MultiPoints** -> exact geodesic circles via `geographiclib-rs` (the same
//!     ellipsoidal model PostGIS `::geography` uses), sampled into an N-gon.
//!   * **Lines / Polygons** -> project WGS84 -> a local UTM zone (pure-Rust `proj4rs`),
//!     run a planar buffer (`geo`'s i_overlay-backed `Buffer`), then project back. UTM is
//!     conformal, so shapes/offsets are preserved to within a few cm over a metro extent.
//!
//! Targets parity with the common PostGIS pattern `ST_Buffer(geom::geography, meters)`:
//! GeoJSON geometry + distance in meters in, a buffered polygon in EPSG:4326 out; PostGIS's
//! default is 8 segments per quadrant.

use crate::core::geojson_io::{geometry_to_geojson, GeoError};
use geo::algorithm::buffer::Buffer;
use geo_types::{Coord, Geometry, LineString, MultiPolygon, Point, Polygon};
use geographiclib_rs::{DirectGeodesic, Geodesic};
use geo::MapCoords;

/// PostGIS `ST_Buffer` default = 8 line segments per 90° quadrant.
pub const DEFAULT_QUAD_SEGMENTS: usize = 8;

/// Buffer a geometry by `meters`, returning a `MultiPolygon` in EPSG:4326.
pub fn buffer_meters(
    geom: &Geometry<f64>,
    meters: f64,
    quad_segments: usize,
) -> Result<MultiPolygon<f64>, GeoError> {
    if !meters.is_finite() || meters < 0.0 {
        return Err(GeoError::new("buffer distance must be finite and >= 0"));
    }
    let quad = quad_segments.max(1);
    match geom {
        Geometry::Point(p) => Ok(MultiPolygon::new(vec![geodesic_circle(*p, meters, quad)])),
        Geometry::MultiPoint(mp) => Ok(MultiPolygon::new(
            mp.iter().map(|p| geodesic_circle(*p, meters, quad)).collect(),
        )),
        other => buffer_via_utm(other, meters),
    }
}

/// Convenience: GeoJSON geometry string in, buffered GeoJSON (Multi)Polygon string out.
pub fn buffer_geojson(
    geojson_geom: &str,
    meters: f64,
    quad_segments: usize,
) -> Result<String, GeoError> {
    let geom = crate::core::geometry_from_geojson(geojson_geom)?;
    let buffered = buffer_meters(&geom, meters, quad_segments)?;
    Ok(geometry_to_geojson(&Geometry::MultiPolygon(buffered)))
}

/// Exact ellipsoidal circle of radius `meters` around a point, sampled at `4*quad` vertices.
fn geodesic_circle(center: Point<f64>, meters: f64, quad: usize) -> Polygon<f64> {
    let g = Geodesic::wgs84();
    let n = (quad * 4).max(8);
    let (lon, lat) = (center.x(), center.y());
    let mut ring: Vec<Coord<f64>> = Vec::with_capacity(n + 1);
    for i in 0..n {
        // Negative azimuth (N -> W -> S -> E) gives a counter-clockwise exterior ring, which
        // is the GeoJSON/right-hand convention `geodesic_area` expects (CW would return the
        // complement of the disk).
        let azimuth = -360.0 * (i as f64) / (n as f64);
        // DirectGeodesic<(lat2, lon2)>: walk `meters` from (lat,lon) along `azimuth`.
        let (lat2, lon2) = g.direct(lat, lon, azimuth, meters);
        ring.push(Coord { x: lon2, y: lat2 });
    }
    ring.push(ring[0]);
    Polygon::new(LineString::new(ring), vec![])
}

/// Project to a local UTM zone, planar-buffer, project back to WGS84.
fn buffer_via_utm(geom: &Geometry<f64>, meters: f64) -> Result<MultiPolygon<f64>, GeoError> {
    let (lon0, lat0) = centroid_lonlat(geom)?;
    let wgs84 = proj4rs::Proj::from_proj_string("+proj=longlat +datum=WGS84 +no_defs")
        .map_err(|e| GeoError::new(format!("proj wgs84: {e:?}")))?;
    let utm = utm_proj(lon0, lat0)?;

    let projected = reproject(geom, &wgs84, &utm, true, false)?;

    let buffered: MultiPolygon<f64> = match projected {
        Geometry::Polygon(p) => p.buffer(meters),
        Geometry::MultiPolygon(mp) => mp.buffer(meters),
        Geometry::LineString(ls) => ls.buffer(meters),
        Geometry::MultiLineString(mls) => mls.buffer(meters),
        Geometry::Line(l) => l.buffer(meters),
        Geometry::GeometryCollection(_) => {
            return Err(GeoError::new("GeometryCollection not supported for buffering"))
        }
        // Points handled before this path; anything else is unexpected.
        _ => return Err(GeoError::new("unsupported geometry for UTM buffer")),
    };

    let out = reproject(&Geometry::MultiPolygon(buffered), &utm, &wgs84, false, true)?;
    match out {
        Geometry::MultiPolygon(mp) => Ok(mp),
        _ => unreachable!("buffer output is always a MultiPolygon"),
    }
}

/// UTM projection for the zone containing `lon`/`lat` (with `+south` below the equator).
fn utm_proj(lon: f64, lat: f64) -> Result<proj4rs::Proj, GeoError> {
    let zone = (((lon + 180.0) / 6.0).floor() as i32).rem_euclid(60) + 1;
    let south = if lat < 0.0 { " +south" } else { "" };
    let s = format!("+proj=utm +zone={zone}{south} +datum=WGS84 +units=m +no_defs");
    proj4rs::Proj::from_proj_string(&s).map_err(|e| GeoError::new(format!("proj utm: {e:?}")))
}

/// Reproject every coordinate of `geom`. proj4rs uses **radians** for geographic CRSs, so we
/// convert on the way in/out as needed. The closure is `Fn + Copy` (only shared refs +
/// `Copy` flags are captured), as required by `try_map_coords`.
fn reproject(
    geom: &Geometry<f64>,
    from: &proj4rs::Proj,
    to: &proj4rs::Proj,
    src_geographic: bool,
    dst_geographic: bool,
) -> Result<Geometry<f64>, GeoError> {
    geom.try_map_coords(|c| {
        let mut p = (
            if src_geographic { c.x.to_radians() } else { c.x },
            if src_geographic { c.y.to_radians() } else { c.y },
            0.0_f64,
        );
        proj4rs::transform::transform(from, to, &mut p)
            .map_err(|e| GeoError::new(format!("proj transform: {e:?}")))?;
        let (x, y) = if dst_geographic {
            (p.0.to_degrees(), p.1.to_degrees())
        } else {
            (p.0, p.1)
        };
        Ok::<Coord<f64>, GeoError>(Coord { x, y })
    })
}

/// Rough centroid (mean of the bounding box) used only to pick the local UTM zone.
fn centroid_lonlat(geom: &Geometry<f64>) -> Result<(f64, f64), GeoError> {
    use geo::BoundingRect;
    let rect = geom
        .bounding_rect()
        .ok_or_else(|| GeoError::new("empty geometry: no bounding rect"))?;
    let c = rect.center();
    Ok((c.x, c.y))
}
