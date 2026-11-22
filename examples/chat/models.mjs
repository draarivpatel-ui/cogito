// Model adapters for the demo chat. Each is `(messages, emit, { signal }) => Promise<void>`
// and speaks cogito frames. No vendor SDK: the Anthropic adapter is plain fetch + SSE.
const sleep = (ms, s) => new Promise((r, j) => { const t = setTimeout(r, ms); s?.addEventListener("abort", () => { clearTimeout(t); j(new Error("aborted")); }); });

export async function fakeModel(messages, emit, { signal }) {
  const last = messages.at(-1)?.content ?? "";
  emit({ s: "thinking" });
  emit({ r: `The user said: ${last}. ` }); await sleep(400, signal);
  if (/\b(search|price|weather|news|look up)\b/i.test(last)) {
    emit({ s: "searching" });
    emit({ p: "web", st: "run", l: "Searching the web" }); await sleep(900, signal);
    emit({ p: "web", st: "ok", l: "Searching the web" });
  }
  emit({ s: "writing" });
  const answer = `You said "${last}". This is a fake model, so I only echo, but the status above and these words arrive as cogito frames over plain fetch. We have ${messages.length} message${messages.length === 1 ? "" : "s"} so far.`;
  for (const w of answer.split(/(?<= )/)) { emit({ t: w }); await sleep(30, signal); }
  emit({ u: [last.length, answer.length] });
}

// Real model, optional. Needs ANTHROPIC_API_KEY. Set COGITO_THINKING=1 to ask for thinking blocks.
export function anthropicModel({ apiKey, baseUrl = "https://api.anthropic.com", model = "claude-sonnet-5-5", thinking = false, fetchImpl = fetch } = {}) {
  return async (messages, emit, { signal }) => {
    const body = { model, max_tokens: 4096, stream: true, messages: messages.map(({ role, content }) => ({ role, content })) };
    if (thinking) body.thinking = { type: "enabled", budget_tokens: 2048 };
    emit({ s: "waiting" });
    const res = await fetchImpl(`${baseUrl}/v1/messages`, { method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { code: res.status === 429 ? "rate_limit" : "upstream" });
    const dec = new TextDecoder(); let buf = "", usage = [0, 0];
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:")); if (!data) continue;
        const ev = JSON.parse(data.slice(5));
        if (ev.type === "message_start") usage[0] = ev.message?.usage?.input_tokens ?? 0;
        else if (ev.type === "content_block_start") emit({ s: ev.content_block.type === "thinking" ? "thinking" : ev.content_block.type === "text" ? "writing" : "searching" });
        else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "thinking_delta") emit({ r: ev.delta.thinking });
          else if (ev.delta.type === "text_delta") emit({ t: ev.delta.text });
        } else if (ev.type === "message_delta") usage[1] = ev.usage?.output_tokens ?? usage[1];
        else if (ev.type === "error") throw Object.assign(new Error(ev.error?.message ?? "upstream error"), { code: "upstream" });
      }
    }
    emit({ u: usage });
  };
}
