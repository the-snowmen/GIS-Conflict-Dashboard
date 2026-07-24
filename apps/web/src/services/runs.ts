// Durable saved analyses — one IndexedDB store, no backend, no dependency (the
// hand-rolled wrapper mirrors the hand-rolled ZIP in export.ts). A saved run is the
// exact state needed to re-open it: inputs (area/buffer/rule/layers) + the result
// snapshot (evidence embedded, so a reopened run renders without touching DuckDB).
//
// Failure posture mirrors overlay.ts: IndexedDB can be missing/blocked (private
// mode, quota) — every call degrades to a safe fallback + console.warn, the flag
// flips `runsDbAvailable()` to false for the UI notice, and the app stays
// session-only but fully functional. The portable JSON project is the durable path.
import type { FeatureCollection, Geometry } from "geojson";
import type { ConflictRule } from "./demo";
import type { RunResult, WorkArea } from "../types";

export interface SavedArea {
  source: WorkArea["source"];
  ticketId?: string;
  importName?: string;
  geometry: Geometry;
}

export interface AnalysisRun {
  id: string; // "run_" + base36 (same idiom as nextTicketId)
  name: string;
  notes: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // bumped on rename, re-run, re-save

  area: SavedArea;
  buffer: { radiusM: number };
  rule: ConflictRule;
  rulePresetName?: string; // undefined = custom rule

  layers: {
    hexOn: boolean;
    importedOverlay?: { name: string; features: FeatureCollection };
  };

  result: RunResult | null; // null = saved as a draft (configured, not run)
}

export function newRunId(): string {
  return `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

// The work-area label is derivable from the saved area — same wording the live UI uses.
export function areaLabel(a: SavedArea): string {
  switch (a.source) {
    case "ticket":
      return `Ticket ${a.ticketId}`;
    case "polygon":
      return "Drawn area";
    case "import":
      return `Imported: ${a.importName ?? "feature"}`;
    default: {
      const [lng, lat] = a.geometry.type === "Point" ? a.geometry.coordinates : [0, 0];
      return `Point ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }
}

export function defaultRunName(a: SavedArea, radiusM: number): string {
  const date = new Date().toLocaleDateString([], { month: "short", day: "numeric" });
  const dist = a.geometry.type === "Point" ? ` · ${radiusM} m` : "";
  return `${areaLabel(a)}${dist} · ${date}`;
}

export function workAreaOf(a: SavedArea): WorkArea {
  return { source: a.source, ticketId: a.ticketId, importName: a.importName, geometry: a.geometry, label: areaLabel(a) };
}

// --- IndexedDB ----------------------------------------------------------------
const DB_NAME = "gcd";
const DB_VERSION = 1;
const STORE = "runs";

let available = true;
export function runsDbAvailable(): boolean {
  return available;
}
function unavailable(): boolean {
  return typeof indexedDB === "undefined" || !available;
}
// Latch the store off for the session — only for a *structural* failure (the database
// can't be opened at all: private mode, blocked upgrade, no IndexedDB). A one-off
// operation error (quota, an aborted transaction) must NOT do this, or a single failed
// write would blank every future read of the saved-runs list.
function markUnavailable(e: unknown): void {
  available = false;
  console.warn("[runs] IndexedDB unavailable — saved runs are session-only this browser:", e);
}
// A per-operation failure: log it, but leave the store available so the next read/write
// can still succeed. The caller returns its own safe fallback.
function opFailed(e: unknown): void {
  console.warn("[runs] IndexedDB operation failed (store still available):", e);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("database blocked"));
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (unavailable()) return Promise.reject(new Error("IndexedDB unavailable"));
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
    (e) => {
      // The database itself couldn't be opened — a structural failure. This is the
      // only condition that latches the store off for the session.
      markUnavailable(e);
      throw e;
    },
  );
}

/** All saved runs, most recently updated first. Degrades to [] when IDB is blocked. */
export async function listRuns(): Promise<AnalysisRun[]> {
  try {
    const runs = await withStore("readonly", (s) => s.getAll() as IDBRequest<AnalysisRun[]>);
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (e) {
    opFailed(e);
    return [];
  }
}

/** Insert or overwrite a run. Returns false when persistence is unavailable. */
export async function putRun(run: AnalysisRun): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.put(run));
    return true;
  } catch (e) {
    opFailed(e);
    return false;
  }
}

export async function deleteRun(id: string): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.delete(id));
    return true;
  } catch (e) {
    opFailed(e);
    return false;
  }
}

export async function renameRun(id: string, name: string): Promise<boolean> {
  try {
    const run = await withStore("readonly", (s) => s.get(id) as IDBRequest<AnalysisRun | undefined>);
    if (!run) return false;
    return putRun({ ...run, name, updatedAt: new Date().toISOString() });
  } catch (e) {
    opFailed(e);
    return false;
  }
}
