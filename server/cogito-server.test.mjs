import { test, expect } from "bun:test";
import { cogitoResponse } from "./cogito-server.mjs";
import { cogito } from "../client/cogito.mjs";

const run = async (emit) => { emit({ s: "thinking" }); emit({ r: "hmm" }); emit({ p: "web", st: "run" }); emit({ t: "Hi" }); emit({ t: "!" }); };
const serve = (opts) => Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, run, opts) });
const collect = async (it) => { const o = []; for await (const f of it) o.push(f); return o; };
const text = (fr) => fr.filter((f) => f.t).map((f) => f.t).join("");

for (const start of ["bin", "ndjson", "sse"]) {
  test(`round trip over ${start}`, async () => {
    const s = serve(); const fr = await collect(cogito(`http://localhost:${s.port}/`, {}, { start, level: 2 }));
    expect(fr[0].h.fmt).toBe(start); expect(text(fr)).toBe("Hi!"); expect(fr.at(-1)).toEqual({ d: 1 });
    expect(fr.some((f) => f.r)).toBe(true); s.stop();
  });
}
test("level 0 drops steps and reasoning, level 1 drops reasoning", async () => {
  const s = serve(); const u = `http://localhost:${s.port}/`;
  const l0 = await collect(cogito(u, {}, { level: 0 })), l1 = await collect(cogito(u, {}, { level: 1 }));
  expect(l0.some((f) => f.p || f.r)).toBe(false); expect(l1.some((f) => f.p)).toBe(true); expect(l1.some((f) => f.r)).toBe(false); s.stop();
});
test("server never serves above maxLevel", async () => {
  const s = serve({ maxLevel: 1 }); const fr = await collect(cogito(`http://localhost:${s.port}/`, {}, { level: 2 }));
  expect(fr[0].h.lvl).toBe(1); expect(fr.some((f) => f.r)).toBe(false); s.stop();
});
test("406 for unsupported Accept", async () => {
  const s = serve(); const r = await fetch(`http://localhost:${s.port}/`, { headers: { accept: "application/xml" } });
  expect(r.status).toBe(406); s.stop();
});
test("a thrown error becomes an e frame", async () => {
  const s = Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, async () => { throw Object.assign(new Error("slow down"), { code: "rate_limit" }); }) });
  const fr = await collect(cogito(`http://localhost:${s.port}/`, {})); expect(fr.at(-1)).toEqual({ e: { c: "rate_limit", m: "slow down" } }); s.stop();
});
test("client abort reaches the model", async () => {
  let aborted = false;
  const s = Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, async (emit, { signal }) => { emit({ t: "a" }); await new Promise((r) => signal.addEventListener("abort", () => { aborted = true; r(); })); }) });
  const ac = new AbortController();
  try { for await (const f of cogito(`http://localhost:${s.port}/`, {}, { signal: ac.signal })) { if (f.t) ac.abort(); } } catch (e) { expect(e.name).toBe("AbortError"); }
  await new Promise((r) => setTimeout(r, 100)); expect(aborted).toBe(true); s.stop();
});

// ---- compression ----------------------------------------------------------------------------------------------
const slow = async (emit) => { emit({ t: "one" }); await new Promise((r) => setTimeout(r, 150)); emit({ t: "two" }); };
const timed = async (url, headers) => {
  const res = await fetch(url, { method: "POST", headers });
  const t0 = performance.now(), seen = []; let text = "";
  for await (const chunk of res.body) { const s = new TextDecoder().decode(chunk); text += s; if (s.includes("one") || s.includes("two")) seen.push([performance.now() - t0, s.includes("one") ? "one" : "two"]); }
  return { res, text, seen };
};
for (const codec of ["zstd", "br", "gzip"]) {
  test(`${codec}: negotiated, decodes, and each frame leaves at once`, async () => {
    const s = Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, slow) });
    const { res, text, seen } = await timed(`http://localhost:${s.port}/`, { "accept-encoding": codec });
    expect(res.headers.get("content-encoding")).toBe(codec);
    expect(text).toContain('{"t":"one"}'); expect(text).toContain('{"t":"two"}');
    const one = seen.find((x) => x[1] === "one")[0], two = seen.find((x) => x[1] === "two")[0];
    expect(two - one).toBeGreaterThan(100);   // "one" was not held back until "two" was ready
    s.stop();
  });
}
test("prefers zstd over br over gzip, and no codec when none accepted", async () => {
  const s = Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, async () => {}) });
  const enc = async (h) => (await fetch(`http://localhost:${s.port}/`, { method: "POST", headers: h })).headers.get("content-encoding");
  expect(await enc({ "accept-encoding": "gzip, br, zstd" })).toBe("zstd");
  expect(await enc({ "accept-encoding": "gzip, br" })).toBe("br");
  expect(await enc({ "accept-encoding": "identity" })).toBeNull();
  s.stop();
});
test("compress: false sends the stream as is", async () => {
  const s = Bun.serve({ port: 0, fetch: (req) => cogitoResponse(req, async () => {}, { compress: false }) });
  expect((await fetch(`http://localhost:${s.port}/`, { method: "POST", headers: { "accept-encoding": "zstd" } })).headers.get("content-encoding")).toBeNull(); s.stop();
});
