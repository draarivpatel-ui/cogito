// Temporary probe: 30 frames, 100 ms apart, under different content types and encodings.
const N = 30, GAP = 100;
const frame = (i) => JSON.stringify(i === 0 ? { h: { v: 1, id: "probe", lvl: 1, ret: "none", fmt: "ndjson" } } : i === N - 1 ? { d: 1 } : { t: `word${i} ` }) + "\n";
const sse = (s) => `data: ${s.trim()}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function body(wrap, own) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), enc = new TextEncoder();
  (async () => { for (let i = 0; i < N; i++) { await w.write(enc.encode(wrap(frame(i)))); if (i < N - 1) await sleep(GAP); } await w.close(); })();
  if (!own) return readable;
  // Our own gzip, one write per frame, to see whether CompressionStream flushes.
  return readable.pipeThrough(new CompressionStream("gzip"));
}
const COGITO = "application/vnd.flisk.cogito+ndjson";
const ROUTES = {
  "/cogito": () => new Response(body((s) => s), { headers: { "content-type": COGITO, "cache-control": "no-store" } }),
  "/cogito-notransform": () => new Response(body((s) => s), { headers: { "content-type": COGITO, "cache-control": "no-store, no-transform" } }),
  "/x-ndjson": () => new Response(body((s) => s), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } }),
  "/sse": () => new Response(body(sse), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } }),
  "/json": () => new Response(body((s) => s), { headers: { "content-type": "application/json", "cache-control": "no-store" } }),
  "/own-gzip": () => new Response(body((s) => s, true), { headers: { "content-type": COGITO, "content-encoding": "gzip", "cache-control": "no-store, no-transform" } }),
};
export default { fetch: (req) => (ROUTES[new URL(req.url).pathname] || (() => new Response(Object.keys(ROUTES).join("\n"))))() };
