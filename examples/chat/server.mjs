// Standalone demo chat on cogito. Fake model by default; set ANTHROPIC_API_KEY for a real one.
//   bun examples/chat/server.mjs   ->  http://localhost:8788
import { cogitoResponse } from "../../server/cogito-server.mjs";
import { fakeModel, anthropicModel } from "./models.mjs";

const model = process.env.ANTHROPIC_API_KEY
  ? anthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.COGITO_MODEL, thinking: process.env.COGITO_THINKING === "1", baseUrl: process.env.ANTHROPIC_BASE_URL })
  : fakeModel;

export function handle(req, m = model) {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/v1/cogito") {
    return req.json().catch(() => ({})).then(({ messages = [] }) => {
      const clean = (Array.isArray(messages) ? messages : []).slice(-40)
        .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
        .map((x) => ({ role: x.role, content: x.content.slice(0, 8000) }));
      if (!clean.length || clean.at(-1).role !== "user") return new Response("messages must end with a user message", { status: 400 });
      return cogitoResponse(req, (emit, ctx) => m(clean, emit, ctx));
    });
  }
  if (url.pathname === "/cogito.mjs") return new Response(Bun.file(new URL("../../client/cogito.mjs", import.meta.url)), { headers: { "content-type": "text/javascript" } });
  if (url.pathname === "/") return new Response(Bun.file(new URL("web/index.html", import.meta.url)), { headers: { "content-type": "text/html" } });
  return new Response("not found", { status: 404 });
}

if (import.meta.main) {
  const port = Number(process.env.PORT || 8788);
  Bun.serve({ port, fetch: (req) => handle(req) });
  console.log(`cogito chat on http://localhost:${port} (${process.env.ANTHROPIC_API_KEY ? "real model" : "fake model"})`);
}
