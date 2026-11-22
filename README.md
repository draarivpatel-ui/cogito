# ai-shim

An AI-native streaming protocol for the browser. "Thinking..." as a real part of the
wire format, not a renamed "loading...". Plain `fetch`, no SDK, works in today's browsers.

- [SPEC.md](SPEC.md): draft 0 of the protocol
- [client/shim.mjs](client/shim.mjs): zero-dependency client with the fallback ladder
- [bench/](bench/): wire-format benchmark and results

First users: chat.flisk.si and inference.flisk.si.

```js
import { shim } from "./client/shim.mjs";
for await (const f of shim("/v1/shim", { messages })) {
  if (f.s) setStatus(f.s);        // "thinking", "writing"
  if (f.t) answer += f.t;
}
```

Test: `bun test client`. Draft, not a standard.
