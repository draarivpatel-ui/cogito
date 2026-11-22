# Benchmark results (2026-11-22, bun 1.4.4, macOS)

Run: `bun bench/bench.mjs` (TOKENS=400 default). One answer, every frame flushed.

```
tokens=400  (bytes on the wire, every frame flushed)

┌───┬───────────────────────────────┬────────┬───────┬───────┬──────┬──────┬───────┬─────────┐
│   │ format                        │ frames │ none  │ gzip  │ br   │ zstd │ br ms │ zstd ms │
├───┼───────────────────────────────┼────────┼───────┼───────┼──────┼──────┼───────┼─────────┤
│ 0 │ vercel-style SSE              │ 410    │ 24209 │ 26992 │ 4773 │ 4661 │ 30.1  │ 20.1    │
│ 1 │ openai-style SSE              │ 410    │ 64553 │ 54800 │ 4853 │ 4848 │ 18.6  │ 20.4    │
│ 2 │ cogito NDJSON (short keys)   │ 410    │ 5977  │ 10505 │ 4443 │ 4409 │ 23.8  │ 15.1    │
│ 3 │ cogito binary (len-prefixed) │ 410    │ 3476  │ 8006  │ 4174 │ 4403 │ 84.4  │ 23.6    │
└───┴───────────────────────────────┴────────┴───────┴───────┴──────┴──────┴───────┴─────────┘

raw size vs vercel-style SSE: vercel-style SSE: 100% | openai-style SSE: 267% | cogito NDJSON (short keys): 25% | cogito binary (len-prefixed): 14%
```

Reading:
- Uncompressed, short-key NDJSON is 25% of Vercel-style SSE; binary is 14%.
- With `br` or `zstd` all formats land within about 14% of each other (4.2 to 4.8 KB). Compression erases most of the format gap, so readable NDJSON is the default.
- `gzip` with a flush per frame is worse than no compression for Vercel-style SSE (26,992 vs 24,209 bytes). Do not use it for live streams.
- Not measured yet: real CDNs and proxies (they may buffer compressed streams), and CPU on a phone.
