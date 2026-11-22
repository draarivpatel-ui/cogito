# Benchmark results (2026-11-22, bun 1.4.4, macOS)

Run: `bun bench/bench.mjs` (TOKENS=400 default). One answer, every frame flushed.

```
```

Reading:
- Uncompressed, short-key NDJSON is 25% of Vercel-style SSE; binary is 14%.
- With `br` or `zstd` all formats land within about 14% of each other (4.2 to 4.8 KB). Compression erases most of the format gap, so readable NDJSON is the default.
- `gzip` with a flush per frame is worse than no compression for Vercel-style SSE (26,992 vs 24,209 bytes). Do not use it for live streams.
- Not measured yet: real CDNs and proxies (they may buffer compressed streams), and CPU on a phone.
