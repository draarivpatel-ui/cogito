// cogito server helper, draft 0. Zero dependencies, Web-standard Request/Response
// (runs on Bun, Cloudflare Workers, Deno, Node 18+).
//   return cogitoResponse(req, async (emit, ctx) => { emit({ s: "thinking" }); ... emit({ t: "Hi" }); });
const TYPES = { t: 1, s: 2, p: 3, u: 4, d: 5, h: 6, e: 7, r: 8 };
const MEDIA = { bin: "application/vnd.flisk.cogito.bin", ndjson: "application/vnd.flisk.cogito+ndjson", sse: "text/event-stream" };
const enc = new TextEncoder();

function negotiate(accept) {
  if (!accept) return "ndjson";
  const ranked = accept.split(",").map((part, i) => {
    const [type, ...params] = part.trim().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { type: type.trim(), q: q ? Number(q.slice(2)) : 1, i };
  }).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { type } of ranked) {
    if (type === "*/*") return "ndjson";
    const fmt = Object.keys(MEDIA).find((k) => MEDIA[k] === type);
    if (fmt) return fmt;
  }
  return null;
}

// Compression: zstd, br or gzip when the client accepts it, flushed after every frame so each frame leaves at once.
// Needs node:zlib (Bun, Node, Workers with nodejs_compat); without it the stream is sent as is and the edge may compress it.
let zlib = null;
try { zlib = await import("node:zlib"); } catch { /* no node:zlib on this runtime */ }
const CODECS = {
  zstd: () => zlib?.createZstdCompress && { z: zlib.createZstdCompress(), flush: (z) => z.flush() },
  br: () => zlib?.createBrotliCompress && { z: zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }), flush: (z) => z.flush() },
  gzip: () => zlib?.createGzip && { z: zlib.createGzip(), flush: (z) => z.flush(zlib.constants.Z_SYNC_FLUSH) },
};
const AVAILABLE = { zstd: !!zlib?.createZstdCompress, br: !!zlib?.createBrotliCompress, gzip: !!zlib?.createGzip };
function pickCodec(acceptEncoding) {
  const has = new Set((acceptEncoding ?? "").split(",").map((s) => s.split(";")[0].trim().toLowerCase()));
  return ["zstd", "br", "gzip"].find((c) => has.has(c) && AVAILABLE[c]);
}

function varint(n) { const o = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return o; }

function encode(fmt, frame) {
  if (fmt === "ndjson") return enc.encode(JSON.stringify(frame) + "\n");
  if (fmt === "sse") return enc.encode(`data: ${JSON.stringify(frame)}\n\n`);
  const key = Object.keys(frame)[0], v = frame[key];
  const body = enc.encode(key === "t" || key === "s" || key === "r" ? v : key === "d" ? "" : JSON.stringify(key === "h" || key === "e" ? v : frame));
  return Uint8Array.from([TYPES[key], ...varint(body.length), ...body]);
}

export function cogitoResponse(req, run, { maxLevel = 2, retention = "none", id, compress = true } = {}) {
  const fmt = negotiate(req.headers.get("accept"));
  if (!fmt) return new Response("cogito: supported types: " + Object.values(MEDIA).join(", "), { status: 406 });
  const asked = Number.parseInt(req.headers.get("cogito-level") ?? "1", 10);
  const level = Math.min(Number.isNaN(asked) ? 1 : Math.max(asked, 0), maxLevel);
  const runId = id ?? "r_" + crypto.randomUUID().slice(0, 8);
  const codec = compress ? pickCodec(req.headers.get("accept-encoding")) : null;
  const ctl = new AbortController();
  req.signal?.addEventListener("abort", () => ctl.abort());

  const stream = new ReadableStream({
    async start(c) {
      const zc = codec ? CODECS[codec]() : null;
      if (zc) { zc.z.on("data", (d) => { if (!ctl.signal.aborted) c.enqueue(new Uint8Array(d)); }); zc.z.on("error", () => ctl.abort()); }
      const write = (bytes) => { if (ctl.signal.aborted) return; if (zc) { zc.z.write(bytes); zc.flush(zc.z); } else c.enqueue(bytes); };
      const send = (f) => write(encode(fmt, f));
      const emit = (f) => {
        const k = Object.keys(f)[0];
        if (k === "p" && level < 1) return;       // steps need level 1
        if (k === "r" && level < 2) return;       // reasoning needs level 2
        if (k === "h" || k === "d" || k === "e") return; // reserved for the helper
        send(f);
      };
      send({ h: { v: 1, id: runId, lvl: level, ret: retention, fmt } });
      try { await run(emit, { level, signal: ctl.signal, request: req }); send({ d: 1 }); }
      catch (err) { send({ e: { c: err?.code ?? "internal", m: String(err?.message ?? err) } }); }
      if (zc) await new Promise((r) => { zc.z.on("end", r); zc.z.on("close", r); zc.z.end(); });
      try { c.close(); } catch {}
    },
    cancel() { ctl.abort(); },
  });
  return new Response(stream, { headers: { "content-type": MEDIA[fmt], "cache-control": "no-store", "x-accel-buffering": "no", vary: "Accept, Accept-Encoding, Cogito-Level", ...(codec ? { "content-encoding": codec } : {}) } });
}
