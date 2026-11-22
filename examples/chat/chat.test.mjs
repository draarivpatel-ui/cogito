import { test, expect } from "bun:test";
import { handle } from "./server.mjs";
import { anthropicModel } from "./models.mjs";
import { cogito } from "../../client/cogito.mjs";

const collect = async (it) => { const o = []; for await (const f of it) o.push(f); return o; };
const sse = (evs) => evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

test("anthropic adapter maps upstream SSE to cogito frames", async () => {
  const upstream = Bun.serve({ port: 0, fetch: async (req) => {
    const b = await req.json(); expect(b.messages.at(-1).content).toBe("hi"); expect(req.headers.get("x-api-key")).toBe("k");
    return new Response(sse([
      { type: "message_start", message: { usage: { input_tokens: 7 } } },
      { type: "content_block_start", content_block: { type: "thinking" } }, { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } },
      { type: "content_block_start", content_block: { type: "text" } }, { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }, { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_delta", usage: { output_tokens: 2 } }, { type: "message_stop" }]), { headers: { "content-type": "text/event-stream" } });
  } });
  const model = anthropicModel({ apiKey: "k", baseUrl: `http://localhost:${upstream.port}` });
  const app = Bun.serve({ port: 0, fetch: (req) => handle(req, model) });
  const fr = await collect(cogito(`http://localhost:${app.port}/v1/cogito`, { messages: [{ role: "user", content: "hi" }] }, { level: 2 }));
  expect(fr.filter((f) => f.t).map((f) => f.t).join("")).toBe("Hello");
  expect(fr.filter((f) => f.s).map((f) => f.s)).toEqual(["waiting", "thinking", "writing"]);
  expect(fr.find((f) => f.r)).toEqual({ r: "hm" }); expect(fr.find((f) => f.u)).toEqual({ u: [7, 2] }); expect(fr.at(-1)).toEqual({ d: 1 });
  upstream.stop(); app.stop();
});
test("upstream 429 becomes a rate_limit error frame", async () => {
  const upstream = Bun.serve({ port: 0, fetch: () => new Response("slow", { status: 429 }) });
  const app = Bun.serve({ port: 0, fetch: (req) => handle(req, anthropicModel({ apiKey: "k", baseUrl: `http://localhost:${upstream.port}` })) });
  const fr = await collect(cogito(`http://localhost:${app.port}/v1/cogito`, { messages: [{ role: "user", content: "hi" }] }));
  expect(fr.at(-1).e.c).toBe("rate_limit"); upstream.stop(); app.stop();
});
test("rejects bad history with 400", async () => {
  const app = Bun.serve({ port: 0, fetch: (req) => handle(req) });
  for (const messages of [[], [{ role: "assistant", content: "x" }], "nope"]) {
    const r = await fetch(`http://localhost:${app.port}/v1/cogito`, { method: "POST", body: JSON.stringify({ messages }) }); expect(r.status).toBe(400);
  } app.stop();
});
test("fake model: search words add a step", async () => {
  const app = Bun.serve({ port: 0, fetch: (req) => handle(req) });
  const fr = await collect(cogito(`http://localhost:${app.port}/v1/cogito`, { messages: [{ role: "user", content: "coffee price" }] }));
  expect(fr.some((f) => f.p === "web" && f.st === "ok")).toBe(true); app.stop();
});
