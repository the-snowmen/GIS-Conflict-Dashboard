// Thin imperative wrapper around MapLibre + terra-draw so the React layer stays declarative.
import maplibregl, {
  Map as MlMap,
  GeoJSONSource,
  LngLat,
  LngLatLike,
  MapGeoJSONFeature,
  Popup,
  StyleSpecification,
} from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// Keyless CARTO dark basemap (raster). Attribution required, no API token.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

const SELF_OWNER = "Operator Alpha";

export type SourceId =
  | "counties"
  | "facilities"
  | "tickets"
  | "hex"
  | "kmz"
  | "aoi"
  | "conflict"
  | "conflict-highlight";

export type InspectHandler = (layerId: string, feature: MapGeoJSONFeature, lngLat: LngLat) => void;

// Clickable layers, highest priority first. queryRenderedFeatures returns hits in render
// order (not this order), so we walk this list and take the first layer with a hit.
const INTERACTIVE_LAYERS = [
  "tickets-circle",
  "conflict-line",
  "kmz-point",
  "kmz-line",
  "kmz-fill",
  "facilities-line",
  "hex-fill",
];

export class MapController {
  readonly map: MlMap;
  private draw?: TerraDraw;
  private clickMode: "idle" | "buffer" | "addTicket" = "idle";
  private onBufferClick?: (lng: number, lat: number) => void;
  private onAddPointClick?: (lng: number, lat: number) => void;
  private dragMarker?: maplibregl.Marker;
  private destroyed = false;
  private inspectPopup?: Popup;
  private onInspectClick?: (e: maplibregl.MapMouseEvent) => void;
  private onInspectMove?: (e: maplibregl.MapMouseEvent) => void;
  private highlightRaf?: number;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [-97.74, 30.27],
      zoom: 9,
      // Add the attribution control ourselves (below) so compact mode is guaranteed.
      attributionControl: false,
    });
    if (import.meta.env.DEV) {
      (window as unknown as { __mapctrl?: MapController }).__mapctrl = this;
    }
    // Required OSM/CARTO attribution, collapsed to a compact ⓘ button by default.
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.on("click", (e) => {
      if (this.clickMode === "buffer" && this.onBufferClick) {
        this.onBufferClick(e.lngLat.lng, e.lngLat.lat);
      } else if (this.clickMode === "addTicket" && this.onAddPointClick) {
        this.onAddPointClick(e.lngLat.lng, e.lngLat.lat);
      }
    });
  }

  whenReady(cb: () => void) {
    const guarded = () => {
      if (!this.destroyed) cb();
    };
    if (this.map.loaded()) guarded();
    else this.map.on("load", guarded);
  }

  /** Register empty sources + styled layers; data is pushed later via setData(). */
  initLayers() {
    const src = (id: SourceId) => this.map.addSource(id, { type: "geojson", data: EMPTY });
    (["counties", "facilities", "tickets", "hex", "kmz", "aoi", "conflict", "conflict-highlight"] as SourceId[]).forEach(src);

    this.map.addLayer({
      id: "counties-fill", type: "fill", source: "counties",
      paint: { "fill-color": "#5b9dff", "fill-opacity": 0.05 },
    });
    this.map.addLayer({
      id: "counties-line", type: "line", source: "counties",
      paint: { "line-color": "#5b9dff", "line-width": 1.2, "line-opacity": 0.5 },
    });

    this.map.addLayer({
      id: "hex-fill", type: "fill", source: "hex", layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["get", "count"],
          1, "#22304e", 4, "#3b6fb0", 8, "#ffb347", 16, "#ff6b6b",
        ],
        "fill-opacity": 0.55,
      },
    });

    this.map.addLayer({
      id: "facilities-line", type: "line", source: "facilities",
      paint: {
        "line-color": ["case", ["==", ["get", "owner"], SELF_OWNER], "#5b9dff", "#54607d"],
        "line-width": ["case", ["==", ["get", "owner"], SELF_OWNER], 2.2, 1.2],
        "line-opacity": 0.9,
      },
    });

    this.map.addLayer({
      id: "kmz-line", type: "line", source: "kmz",
      paint: { "line-color": "#c08bff", "line-width": 2 },
    });
    this.map.addLayer({
      id: "kmz-fill", type: "fill", source: "kmz",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#c08bff", "fill-opacity": 0.2 },
    });
    this.map.addLayer({
      id: "kmz-point", type: "circle", source: "kmz",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 5, "circle-color": "#c08bff" },
    });

    this.map.addLayer({
      id: "tickets-circle", type: "circle", source: "tickets",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 13, 5],
        "circle-color": ["case", [">", ["get", "conflict_count"], 0], "#ff6b6b", "#3ecf8e"],
        "circle-opacity": 0.85,
        "circle-stroke-width": 0.5,
        "circle-stroke-color": "#0f1420",
      },
    });

    this.map.addLayer({
      id: "aoi-fill", type: "fill", source: "aoi",
      paint: { "fill-color": "#ffd166", "fill-opacity": 0.18 },
    });
    this.map.addLayer({
      id: "aoi-line", type: "line", source: "aoi",
      paint: { "line-color": "#ffd166", "line-width": 2 },
    });

    this.map.addLayer({
      id: "conflict-line", type: "line", source: "conflict",
      paint: { "line-color": "#ff3b3b", "line-width": 3.5, "line-opacity": 0.95 },
    });

    // Single-feature decoration drawn on top of conflict-line to flag the
    // hovered/selected facility. Not interactive (conflict-line stays clickable).
    this.map.addLayer({
      id: "conflict-highlight", type: "line", source: "conflict-highlight",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff2a8", "line-width": 6, "line-opacity": 1, "line-blur": 0.4 },
    });
  }

  setData(id: SourceId, data: FeatureCollection) {
    if (this.destroyed) return;
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }

  /**
   * Flag a single facility geometry on the conflict-highlight overlay.
   * pulse=true animates width/opacity (for hover); pulse=false is a steady
   * bright stroke (for a clicked/selected facility). Pass null to clear.
   */
  highlightConflictFacility(geom: Geometry | null, pulse = true) {
    if (this.destroyed) return;
    if (this.highlightRaf !== undefined) {
      cancelAnimationFrame(this.highlightRaf);
      this.highlightRaf = undefined;
    }
    const src = this.map.getSource("conflict-highlight") as GeoJSONSource | undefined;
    if (!geom) {
      src?.setData(EMPTY);
      return;
    }
    src?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
    if (!pulse) {
      this.map.setPaintProperty("conflict-highlight", "line-width", 6);
      this.map.setPaintProperty("conflict-highlight", "line-opacity", 1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      if (this.destroyed || !this.map.getLayer("conflict-highlight")) return;
      const phase = (Math.sin(((now - start) / 600) * Math.PI * 2) + 1) / 2; // 0..1, ~600ms period
      this.map.setPaintProperty("conflict-highlight", "line-width", 4 + phase * 6);
      this.map.setPaintProperty("conflict-highlight", "line-opacity", 0.55 + phase * 0.45);
      this.highlightRaf = requestAnimationFrame(tick);
    };
    this.highlightRaf = requestAnimationFrame(tick);
  }

  setLayerVisible(layerId: string, visible: boolean) {
    if (this.map.getLayer(layerId)) {
      this.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }

  fitTo(fc: FeatureCollection, padding = 40) {
    const b = bounds(fc);
    if (b) this.map.fitBounds(b, { padding, duration: 600 });
  }

  // --- AOI creation modes --------------------------------------------------
  enableBufferClick(cb: (lng: number, lat: number) => void) {
    this.clickMode = "buffer";
    this.onBufferClick = cb;
    this.map.getCanvas().style.cursor = "crosshair";
  }

  disableBufferClick() {
    this.clickMode = "idle";
    this.onBufferClick = undefined;
    this.map.getCanvas().style.cursor = "";
  }

  // --- ticket placement ----------------------------------------------------
  /** Next map click reports its location (for placing a new ticket point). */
  enableAddPoint(cb: (lng: number, lat: number) => void) {
    this.clickMode = "addTicket";
    this.onAddPointClick = cb;
    this.map.getCanvas().style.cursor = "crosshair";
  }

  disableAddPoint() {
    if (this.clickMode === "addTicket") this.clickMode = "idle";
    this.onAddPointClick = undefined;
    this.map.getCanvas().style.cursor = "";
  }

  /** Drop a single draggable marker; onDragEnd fires with its final position. */
  spawnDragMarker(lng: number, lat: number, onDragEnd: (lng: number, lat: number) => void) {
    this.removeDragMarker();
    const m = new maplibregl.Marker({ draggable: true, color: "#ffd166" })
      .setLngLat([lng, lat])
      .addTo(this.map);
    m.on("dragend", () => {
      const p = m.getLngLat();
      onDragEnd(p.lng, p.lat);
    });
    this.dragMarker = m;
  }

  removeDragMarker() {
    this.dragMarker?.remove();
    this.dragMarker = undefined;
  }

  // --- feature inspection --------------------------------------------------
  /** True while buffer-click or an active polygon draw should own clicks (not inspect). */
  private get inspectBusy(): boolean {
    return this.clickMode !== "idle" || (!!this.draw && this.draw.getMode() !== "static");
  }

  /** Pick the topmost interesting feature under a point, by INTERACTIVE_LAYERS priority. */
  private pickFeature(point: maplibregl.PointLike): { layerId: string; feature: MapGeoJSONFeature } | null {
    const hits = this.map.queryRenderedFeatures(point, { layers: INTERACTIVE_LAYERS });
    for (const layerId of INTERACTIVE_LAYERS) {
      const feature = hits.find((f) => f.layer.id === layerId);
      if (feature) return { layerId, feature };
    }
    return null;
  }

  /** Click an interactive feature -> onInspect; hover toggles a pointer cursor. */
  enableInspect(onInspect: InspectHandler) {
    this.onInspectClick = (e) => {
      if (this.inspectBusy) return;
      const hit = this.pickFeature(e.point);
      if (hit) onInspect(hit.layerId, hit.feature, e.lngLat);
    };
    this.onInspectMove = (e) => {
      if (this.inspectBusy) return;
      this.map.getCanvas().style.cursor = this.pickFeature(e.point) ? "pointer" : "";
    };
    this.map.on("click", this.onInspectClick);
    this.map.on("mousemove", this.onInspectMove);
  }

  disableInspect() {
    if (this.onInspectClick) this.map.off("click", this.onInspectClick);
    if (this.onInspectMove) this.map.off("mousemove", this.onInspectMove);
    this.onInspectClick = undefined;
    this.onInspectMove = undefined;
    if (this.clickMode === "idle") this.map.getCanvas().style.cursor = "";
  }

  /** Show the single reusable popup at a location with a (safely built) DOM node. */
  showInspectPopup(lngLat: LngLatLike, content: Node) {
    if (this.destroyed) return;
    this.inspectPopup ??= new maplibregl.Popup({
      className: "insp-popup",
      closeButton: true,
      closeOnClick: false,
      maxWidth: "260px",
    });
    this.inspectPopup.setLngLat(lngLat).setDOMContent(content).addTo(this.map);
  }

  hideInspectPopup() {
    this.inspectPopup?.remove();
  }

  startPolygonDraw(onFinish: (geom: Geometry) => void) {
    if (!this.draw) {
      this.draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: this.map }),
        modes: [new TerraDrawPolygonMode()],
      });
      this.draw.start();
    }
    this.draw.setMode("polygon");
    const handler = (id: string | number) => {
      const feat = this.draw!.getSnapshot().find((f) => f.id === id) as Feature | undefined;
      if (feat?.geometry) onFinish(feat.geometry);
      this.draw!.clear();
      this.draw!.setMode("static");
      this.draw!.off("finish", handler);
    };
    this.draw.on("finish", handler);
  }

  stopPolygonDraw() {
    this.draw?.setMode("static");
    this.draw?.clear();
  }

  destroy() {
    this.destroyed = true;
    if (this.highlightRaf !== undefined) cancelAnimationFrame(this.highlightRaf);
    this.disableInspect();
    this.removeDragMarker();
    this.inspectPopup?.remove();
    try {
      this.draw?.stop();
    } catch {
      /* draw may not have started */
    }
    this.map.remove();
  }
}

// Compute [[minX,minY],[maxX,maxY]] from a FeatureCollection.
function bounds(fc: FeatureCollection): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (pos: Position) => {
    const [x, y] = pos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") visit(coords as Position);
    else coords.forEach(walk);
  };
  for (const f of fc.features) if (f.geometry && "coordinates" in f.geometry) walk(f.geometry.coordinates);
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}
