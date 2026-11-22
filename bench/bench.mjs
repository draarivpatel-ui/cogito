// Compares stream encodings for one realistic AI answer, per-frame flushed
// (what a live token stream really does), under gzip, brotli and zstd.
import zlib from "node:zlib";

const WORDS = ("the model reads your question then plans a short answer and calls a tool to check the " +
  "price before writing the final reply with sources so you can verify each claim yourself").split(" ");
const N_TOKENS = Number(process.env.TOKENS || 400);
const tokens = Array.from({ length: N_TOKENS }, (_, i) => (i ? " " : "") + WORDS[(i * 7) % WORDS.length]);

// Logical frames: 1 state, 3 steps (start+done each), N text deltas, usage, done.
function logical() {
  const f = [{ k: "state", v: "thinking" }];
  for (const s of ["search", "read", "write"]) { f.push({ k: "step", id: s, st: "run" }); f.push({ k: "step", id: s, st: "ok" }); }
  f.push({ k: "state", v: "writing" });
  for (const t of tokens) f.push({ k: "text", v: t });
  f.push({ k: "usage", in: 812, out: N_TOKENS }, { k: "done" });
  return f;
}
const L = logical();
const enc = new TextEncoder();
const sse = (o) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
const nd = (o) => enc.encode(JSON.stringify(o) + "\n");

const FORMATS = {
  // Vercel AI SDK UI-message-stream style: verbose typed parts, id on every delta.
  "vercel-style SSE": () => L.map((f) => sse(
    f.k === "text" ? { type: "text-delta", id: "msg_1", delta: f.v }
    : f.k === "state" ? { type: "data-state", data: { state: f.v } }
    : f.k === "step" ? { type: "tool-input-available", toolCallId: f.id, toolName: f.id, input: {}, state: f.st }
    : f.k === "usage" ? { type: "finish", usage: { inputTokens: f.in, outputTokens: f.out } }
    : { type: "finish-step" })),
  // OpenAI chat.completions chunk style, for reference only.
  "openai-style SSE": () => L.map((f) => sse({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "m",
    choices: [{ index: 0, delta: f.k === "text" ? { content: f.v } : { role: "assistant" }, finish_reason: null }] })),
  "ai-shim NDJSON (short keys)": () => L.map((f) => nd(
    f.k === "text" ? { t: f.v } : f.k === "state" ? { s: f.v } : f.k === "step" ? { p: f.id, st: f.st }
    : f.k === "usage" ? { u: [f.in, f.out] } : { d: 1 })),
  // 1 byte type + 2 byte length + utf8 payload.
  "ai-shim binary (len-prefixed)": () => L.map((f) => {
    const code = { text: 1, state: 2, step: 3, usage: 4, done: 5 }[f.k];
    const body = enc.encode(f.k === "text" || f.k === "state" ? f.v : f.k === "step" ? f.id + ":" + f.st : f.k === "usage" ? f.in + "," + f.out : "");
    const b = new Uint8Array(3 + body.length); b[0] = code; b[1] = body.length >> 8; b[2] = body.length & 255; b.set(body, 3); return b;
  }),
};

const CODECS = {
  none: null,
  gzip: () => zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH }),
  br: () => zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }),
  zstd: () => zlib.createZstdCompress(),
};

async function wire(frames, mk) {
  if (!mk) return { bytes: frames.reduce((a, b) => a + b.length, 0), ms: 0 };
  const z = mk(); let bytes = 0; z.on("data", (c) => (bytes += c.length));
  const t0 = performance.now();
  for (const fr of frames) { z.write(fr); await new Promise((r) => z.flush(r)); }
  await new Promise((r) => { z.end(); z.on("end", r); z.resume(); });
  return { bytes, ms: performance.now() - t0 };
}

const out = [];
for (const [name, build] of Object.entries(FORMATS)) {
  const frames = build(); const row = { format: name, frames: frames.length };
  for (const [c, mk] of Object.entries(CODECS)) {
    try { const r = await wire(frames, mk); row[c] = r.bytes; row[c + "_ms"] = +r.ms.toFixed(1); } catch (e) { row[c] = "n/a"; }
  }
  out.push(row);
}
console.log(`tokens=${N_TOKENS}  (bytes on the wire, every frame flushed)\n`);
console.table(out.map((r) => ({ format: r.format, frames: r.frames, none: r.none, gzip: r.gzip, br: r.br, zstd: r.zstd,
  "br ms": r.br_ms, "zstd ms": r.zstd_ms })));
const base = out[0].none;
console.log("\nraw size vs vercel-style SSE:", out.map((r) => `${r.format}: ${(100 * r.none / base).toFixed(0)}%`).join(" | "));
