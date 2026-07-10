#!/usr/bin/env node
// Capture a smooth demo walkthrough as a sequence of JPEG frames over the Chrome
// DevTools Protocol — no screen-recorder app, no puppeteer. Node's global WebSocket
// (Node >= 21) is the only dependency.
//
// Usage:
//   1. Serve the app, then launch Chrome headed with a debugging port:
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          --remote-debugging-port=9222 --user-data-dir=/tmp/demo-profile \
//          --no-first-run --no-default-browser-check --window-size=1400,900 \
//          --hide-scrollbars "http://localhost:5173/"
//   2. node scripts/record_demo.mjs --port 9222 --out /tmp/frames --width 1600 --height 1000 --fps 10
//
// Frames are grabbed at a FIXED interval via Page.captureScreenshot (not the paint-driven
// screencast), so deliberate "holds" become near-identical frames that the GIF encoder
// delta-compresses to almost nothing — keeping a mostly-static, low-motion walkthrough
// small while smooth. The layout viewport is pinned via Emulation.setDeviceMetricsOverride
// (independent of window size): WIDTH x HEIGHT CSS px at DPR 2 -> 2*WIDTH x 2*HEIGHT device
// frames. Feed the frames to scripts/make_demo_gif.sh.

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const PORT = args.port ?? "9222";
const OUT = args.out ?? "/tmp/demo-frames";
const URL_MATCH = args["url-match"] ?? "localhost";
const W = Number(args.width ?? 1600);
const H = Number(args.height ?? 1000);
const DPR = Number(args.dpr ?? 2);
const FPS = Number(args.fps ?? 10);
const INTERVAL = 1000 / FPS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- discover the page target and open its CDP socket -----------------------
const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page" && (t.url || "").includes(URL_MATCH));
if (!page) {
  console.error(`No page target matching "${URL_MATCH}" on :${PORT}.`);
  console.error(targets.map((t) => `${t.type} ${t.url}`).join("\n"));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// --- CDP interaction helpers ------------------------------------------------
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function clickText(text) {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (el) { el.click(); return true; } return false;
  })()`);
  if (!ok) console.warn(`  (button "${text}" not found)`);
  return ok;
}
async function clickMatch(re) {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent));
    if (el) { el.click(); return true; } return false;
  })()`);
  if (!ok) console.warn(`  (button matching ${re} not found)`);
  return ok;
}
async function canvasRect() {
  return evaluate(`(() => {
    const c = document.querySelector('.maplibregl-canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
}
async function wheel(x, y, deltaY, steps = 3) {
  for (let i = 0; i < steps; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
    await sleep(60);
  }
}

// --- fixed-interval frame grabber (runs concurrently with the tour) ---------
let frameCount = 0;
let recording = false;
async function captureLoop() {
  while (recording) {
    const t0 = Date.now();
    try {
      const { data } = await send("Page.captureScreenshot", {
        format: "jpeg", quality: 82, captureBeyondViewport: false,
      });
      const idx = String(++frameCount).padStart(5, "0");
      await writeFile(join(OUT, `frame-${idx}.jpg`), Buffer.from(data, "base64"));
    } catch { /* page busy mid-navigation — skip this tick */ }
    const rest = INTERVAL - (Date.now() - t0);
    if (rest > 0) await sleep(rest);
  }
}

// --- run --------------------------------------------------------------------
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: H, deviceScaleFactor: DPR, mobile: false,
});
await send("Page.navigate", { url: page.url }); // clean default state every run
await sleep(600);

process.stdout.write("Waiting for app to load");
for (let i = 0; i < 80; i++) {
  const ready = await evaluate(
    `!!document.querySelector('.maplibregl-canvas') && /facilities/i.test(document.body.textContent)`,
  ).catch(() => false);
  if (ready) break;
  process.stdout.write(".");
  await sleep(500);
}
console.log(" ready.");
await sleep(1800); // let tiles settle

recording = true;
const grab = captureLoop();
const c = await canvasRect();
const cx = c.x + c.w / 2;
const cy = c.y + c.h / 2;
console.log(`Recording @ ${W}x${H} (dpr ${DPR}, ${FPS}fps). map ${Math.round(c.w)}x${Math.round(c.h)}`);

// The tour is deliberately low-motion: hold on each state, let transitions carry it.
// Beat 1 — the H3 conflict-index choropleth (the default analyst workspace).
await sleep(1800);
await wheel(cx, cy, -90, 2); // a touch of life
await sleep(1400);
// Drill the top-ranked hotspot cell (flashes + flies to it, lists its tickets).
console.log("· drill top hotspot cell");
await clickMatch("/conflict rate/");
await sleep(2600);

// Beat 2 — Tickets: the network + facilities + ticket evidence list.
console.log("· switch to Tickets");
await clickText("Tickets");
await sleep(2400);

// Beat 3 — inspect a flagged ticket: fly to it, show the buffer + why-dossier.
console.log("· inspect a flagged ticket");
if (!(await clickMatch("/AUS-100548/"))) await clickMatch("/AUS-/");
await sleep(3000);

// Beat 4 — flip the live conflict rule; the flagged tally recomputes + network recolors.
console.log("· flip the conflict rule");
await clickText("Rule");
await sleep(1400);
await clickText("All operators");
await sleep(2400);
await clickText("In-service only");
await sleep(2400);

// Beat 5 — back to the buffer conflict analysis, settle.
console.log("· buffer conflict");
await clickText("Analyze");
await sleep(2400);

recording = false;
await grab;
ws.close();
console.log(`Done. ${frameCount} frames -> ${OUT}`);
process.exit(0);
