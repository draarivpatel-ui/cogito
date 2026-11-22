// Demo app: a fake "model" (no API key, no network) that streams cogito frames.
// Run: bun examples/server.mjs   then open http://localhost:8787
import { cogitoResponse } from "../server/cogito-server.mjs";
const sleep = (ms, s) => new Promise((r, j) => { const t = setTimeout(r, ms); s?.addEventListener("abort", () => { clearTimeout(t); j(new Error("aborted")); }); });

async function fakeModel(emit, { level, signal }, prompt) {
  emit({ s: "thinking" });
  emit({ r: "The user asks: " + prompt + ". " });  await sleep(300, signal);
  emit({ r: "I should look something up first." });   await sleep(300, signal);
  emit({ s: "searching" });
  emit({ p: "web", st: "run", l: "Looking it up" });  await sleep(700, signal);
  emit({ p: "web", st: "ok", l: "Looking it up" });
  emit({ s: "writing" });
  const answer = `You asked "${prompt}". This answer is streamed by cogito: the status above came from state frames, and this text from text frames, over plain fetch.`;
  for (const w of answer.split(/(?<= )/)) { emit({ t: w }); await sleep(35, signal); }
  emit({ u: [prompt.length, answer.length] });
}

const here = new URL(".", import.meta.url);
Bun.serve({
  port: Number(process.env.PORT || 8787),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/v1/cogito") {
      const { prompt = "hello" } = await req.json().catch(() => ({}));
      return cogitoResponse(req, (emit, ctx) => fakeModel(emit, ctx, String(prompt).slice(0, 200)));
    }
    if (url.pathname === "/cogito.mjs") return new Response(Bun.file(new URL("../client/cogito.mjs", import.meta.url)), { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/") return new Response(Bun.file(new URL("web/index.html", here)), { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  },
});
console.log(`cogito demo on http://localhost:${process.env.PORT || 8787}`);
