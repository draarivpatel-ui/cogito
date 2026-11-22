# cogito protocol, draft 0

Status: draft 0, written 2026-11-22. Not a standard. Nothing here is final.

cogito is a way for a browser (or any HTTP client) to talk to an AI backend and see
what the AI is doing while it works: `thinking`, `searching`, `writing`, then the answer.
It is plain HTTP and plain `fetch`. It needs no SDK, no OpenAI types, no EventSource and
no WebSocket. It works in every browser that exists today.

## 1. Goals

1. "Thinking" is a first-class part of the stream, not a spinner the app invents.
2. Works from day one: `fetch()` + `ReadableStream` + `Content-Encoding`.
3. Small and cheap to parse: a stream is one frame per line, or one binary frame.
4. One request can degrade gracefully (binary -> NDJSON -> SSE) so a bad proxy never
   breaks a chat.
5. Provable claims only (see section 7).

Non-goals: tool-calling schemas, model APIs, auth, billing. Those stay in the app.

## 2. Request

```
POST /v1/cogito HTTP/1.1
Content-Type: application/json
Accept: application/vnd.flisk.cogito.bin, application/vnd.flisk.cogito+ndjson;q=0.9, text/event-stream;q=0.5
Accept-Encoding: zstd, br, gzip
Cogito-Level: 1
```

The body is app-defined JSON (for chat: `{ "messages": [...] }`). cogito does not
constrain it. `Cogito-Level` is how much thinking the client wants: `0` state only,
`1` state and steps (default), `2` also reasoning text. A server may serve a lower level
and says so in the `hello` frame. It must never serve a higher one.

## 3. Response and the fallback ladder

The server picks the best profile it supports from `Accept` and answers with that
`Content-Type`. The ladder, best first:

| Profile | Content-Type | Use when |
|---|---|---|
| bin | `application/vnd.flisk.cogito.bin` | both ends are ours, bandwidth matters |
| ndjson | `application/vnd.flisk.cogito+ndjson` | default, readable with `curl` |
| sse | `text/event-stream` | a proxy refuses unknown types; each line is `data: <ndjson line>\n\n` |

Client rules:
- On `406`/`415`, or no `hello` frame within 5 s, retry once on the next rung down.
- A server must not retry on the client's behalf. The client owns the ladder.
- All profiles carry the same frames (section 4); only the encoding differs.

Compression: servers should flush after every frame. Use `zstd` or `br` for streams.
`gzip` is not recommended: with a flush per frame it was larger than no compression
in our benchmark (see `bench/RESULTS.md`).

## 4. Frames (ndjson profile)

One JSON object per line, one discriminating key per frame.

| Frame | Meaning |
|---|---|
| `{"h":{"v":1,"id":"r_8f2","lvl":1,"ret":"none"}}` | hello: version, run id, served level, retention |
| `{"s":"thinking"}` | state: `thinking` `searching` `reading` `writing` `waiting` |
| `{"p":"web","st":"run","l":"Checking price"}` | step: id, status `run`/`ok`/`err`, optional label (level 1+) |
| `{"t":" word"}` | answer text delta |
| `{"r":"..."}` | reasoning text delta (level 2 only) |
| `{"u":[812,400]}` | usage: input and output tokens |
| `{"e":{"c":"rate_limit","m":"..."}}` | error: stable code, human message |
| `{"d":1,"sig":"..."}` | done; `sig` optional (section 7) |

Rules: the first frame is `h`. The last is `d` or `e`. Unknown keys must be ignored,
so frames can be added without a version bump. A client that has not received `d`
must treat the answer as incomplete.

## 5. Frames (bin profile)

`[type: 1 byte][length: varint][payload: utf-8]`, types: 1 text, 2 state, 3 step,
4 usage, 5 done, 6 hello, 7 error, 8 reasoning. Payloads for step/usage/hello/error are
the same JSON as in section 4. Draft 0 only specifies this far; see `bench/` for why it
is optional (section 8).

## 6. What "thinking" means

`s` frames are the state of the run, not a log. A UI may show the latest `s` as the
"thinking..." label and the open `p` steps as detail. A client that understands none of
this can ignore every frame except `t`, and still render the answer.

## 7. Security claims

We claim only what a client can check:
- `h.ret` states the server's retention promise: `none`, `session` or `logged`.
  This is a declaration by the server, not proof.
- `d.sig` is an optional Ed25519 signature over the SHA-256 of all frame bytes, with the
  key published by the server at `/.well-known/cogito-keys`. It proves who produced the
  stream and that nothing was changed in transit or by a proxy.
- Draft 0 does **not** claim zero knowledge. The server sees the prompt. Zero knowledge
  needs confidential compute with attestation; track it as a later profile.

## 8. Open questions

- Should `bin` exist at all? In our benchmark it won uncompressed (14%) but under
  `br`/`zstd` it is within 6% of NDJSON.
- Do real CDNs flush `br`/`zstd` per frame? Test on Cloudflare, Render and nginx.
- Resume after a dropped connection (`Last-Frame` header?).
- Frame for cancel (client abort is just closing the request; is that enough?).
