# CDN streaming test: Cloudflare Workers (2026-11-23)

Question: does an edge keep streaming frame by frame when it compresses, or does it hold frames back?

Setup: a throwaway Worker (`bench/cdn/worker.js`, deleted afterwards) sends 30 frames 100 ms apart
under six routes. `bench/cdn/measure.mjs` reads each response raw (`decompress: false`) with four
`Accept-Encoding` values and records when each chunk arrives. "Streamed" = at least 15 separate reads
and the first one before 600 ms. Frames ran for about 3.1 s, so a buffered response shows 1-2 reads at the end.

| Route (Content-Type) | Edge compressed it? | Streamed? |
|---|---|---|
| `application/vnd.flisk.cogito+ndjson` (also with `no-transform`) | no | yes: 30 reads, first at about 280 ms |
| `application/x-ndjson` | no | yes |
| `text/event-stream` | no | yes |
| `application/json` (control) | yes: zstd, br and gzip by `Accept-Encoding` | yes: 30 reads, first at about 230 ms |
| cogito type, gzip made in the Worker with `CompressionStream` | n/a | **no: 1-2 reads, frames arrive at the end (about 3.1 s)** |

What it means:
- Cloudflare streams every frame, compressed or not. It does not hold compressed frames back.
- Cloudflare does not compress our media type (nor `x-ndjson` or SSE). A cogito stream on Cloudflare goes out as plain NDJSON. That is cheap: a 400-token answer is about 6 KB raw (see RESULTS.md).
- Do not compress inside a Worker with `CompressionStream`: it buffers and kills streaming. This is the one real trap.
- Only `application/json` got edge compression. Using it would work but gives up the media type, so the spec does not ask for it.

Not tested: Render, nginx, Vercel, a corporate proxy, and `node:zlib` inside Workers (`nodejs_compat`).
The Bun/Node helper in `server/cogito-server.mjs` compresses with zlib and flushes every frame;
its tests check that the first frame leaves 100+ ms before the second.
