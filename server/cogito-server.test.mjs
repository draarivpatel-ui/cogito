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
