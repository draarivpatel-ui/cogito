# cogito

An AI-native streaming protocol for the browser. "Thinking..." as a real part of the
wire format, not a renamed "loading...". Plain `fetch`, no SDK, works in today's browsers.

- [SPEC.md](SPEC.md): draft 0 of the protocol
- [client/cogito.mjs](client/cogito.mjs): zero-dependency client with the fallback ladder
- [server/cogito-server.mjs](server/cogito-server.mjs): `cogitoResponse(req, run)` for Bun, Workers, Deno, Node 18+
- [examples/](examples/): runnable demo app with a fake model, no API key: `bun examples/server.mjs`
- [bench/](bench/): wire-format benchmark and results

First users: chat.flisk.si and inference.flisk.si.

```js
import { cogito } from "./client/cogito.mjs";
for await (const f of cogito("/v1/cogito", { messages })) {
  if (f.s) setStatus(f.s);        // "thinking", "writing"
  if (f.t) answer += f.t;
}
```

Test: `bun test client`. Draft, not a standard.
