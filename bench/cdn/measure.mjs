const host = process.argv[2];
const routes = ["/cogito", "/cogito-notransform", "/x-ndjson", "/sse", "/json", "/own-gzip"];
const encs = { identity: "identity", "browser (gzip, deflate, br, zstd)": "gzip, deflate, br, zstd", "br only": "br", "gzip only": "gzip" };
async function one(path, ae) {
  const t0 = performance.now(); const res = await fetch(`https://${host}${path}`, { headers: { "accept-encoding": ae }, decompress: false });
  const times = []; let bytes = 0;
  for await (const c of res.body) { times.push(performance.now() - t0); bytes += c.length; }
  const first = times[0], last = times.at(-1);
  // Frames are 100 ms apart for ~2.9 s. Streamed = many reads spread over the whole time and the first read comes early.
  return { route: path, accept: ae.length > 12 ? "browser" : ae, status: res.status, encoding: res.headers.get("content-encoding") || "none", type: (res.headers.get("content-type") || "").slice(0, 28),
    reads: times.length, firstMs: Math.round(first), lastMs: Math.round(last), bytes, streamed: times.length >= 15 && first < 600 };
}
const jobs = []; for (const r of routes) for (const ae of Object.values(encs)) jobs.push(one(r, ae));
const rows = (await Promise.all(jobs)).sort((a, b) => a.route.localeCompare(b.route));
console.table(rows);
