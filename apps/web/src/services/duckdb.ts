// DuckDB-WASM bootstrap. On GitHub Pages we get the single-threaded "eh" bundle (no
// SharedArrayBuffer / COOP-COEP needed); selectBundle picks it automatically. The GeoParquet
// assets are registered as HTTP files and read with range requests.
import * as duckdb from "@duckdb/duckdb-wasm";

const TABLES = ["facility", "ticket", "aoi", "county"] as const;

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

function dataUrl(file: string): string {
  return new URL(`${import.meta.env.BASE_URL}data/${file}`, window.location.origin).href;
}

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // Wrap the CDN worker so it loads same-origin (avoids cross-origin Worker restrictions).
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  for (const t of TABLES) {
    await db.registerFileURL(
      `${t}.parquet`,
      dataUrl(`${t}.parquet`),
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
  }
  return db;
}

export async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const db = await (dbPromise ??= initDb());
      const conn = await db.connect();
      try {
        await conn.query("INSTALL spatial;");
      } catch {
        // bundled/autoloaded in some builds — LOAD is the part that matters.
      }
      await conn.query("LOAD spatial;");
      return conn;
    })();
  }
  return connPromise;
}

/** Run a query, returning plain JS row objects. */
export async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const res = await conn.query(sql);
  return res.toArray().map((r: { toJSON(): unknown }) => r.toJSON()) as T[];
}
