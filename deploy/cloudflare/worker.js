// ARCNAVE's front door on Cloudflare (free plan, no card): sky.arcnave.in -> the Hugging Face Space.
// Every request goes to the Space (ORIGIN, a variable set in the Worker's settings). What never changes is also kept in
// Cloudflare's edge cache, near each visitor, so the second person to open a field gets it from Cloudflare at once:
//   - SPHEREx cutouts (/api/spherex/cutout): one image of one spot never changes. Kept 30 days.
//   - sky tiles (/hips/...) and NEOSSat previews: kept 30 days.
//   - the sky viewer library (/vendor/...), pictures, sounds, fonts: as long as the Space says.
// The page itself (HTML, JS, CSS) and the archive searches (/api/... JSON) always come from the Space, so an update shows
// at once and a new SPHEREx data release is seen. See DEPLOY-HF-CLOUDFLARE.md, step 5.
const LONG = 30 * 24 * 3600;
const EDGE = [
  { re: /^\/api\/spherex\/cutout$/, ttl: LONG },
  { re: /^\/hips\//, ttl: LONG },
  { re: /^\/api\/neossat\/preview$/, ttl: LONG },
  { re: /^\/vendor\//, ttl: null },
  { re: /\.(png|jpe?g|gif|webp|mp3|woff2|svg|ico)$/i, ttl: null }
];

export default {
  async fetch(request, env, ctx) {
    const origin = String(env.ORIGIN || '').replace(/\/+$/, '');
    if (!origin) return new Response('Set ORIGIN (the Space address, e.g. https://name-arcnave.hf.space) in the Worker settings.', { status: 500 });
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, origin);
    const rule = request.method === 'GET' ? EDGE.find(r => r.re.test(url.pathname)) : null;

    // the cache key: the address without "cached=1" (the page's "do you have it already?" question asks for the same image)
    let key = null;
    if (rule) {
      const k = new URL(url.toString()); k.searchParams.delete('cached');
      key = new Request(k.toString(), { method: 'GET' });
      const hit = await caches.default.match(key);
      if (hit) { const r = new Response(hit.body, hit); r.headers.set('X-Arcnave-Edge', 'HIT'); return r; }
    }

    const fwd = new Headers(request.headers);
    fwd.set('X-Forwarded-Host', url.host);
    fwd.set('X-Forwarded-Proto', 'https');
    let res;
    try {
      res = await fetch(new Request(target.toString(), { method: request.method, headers: fwd, body: ['GET', 'HEAD'].includes(request.method) ? null : request.body, redirect: 'manual' }));
    } catch (e) {
      return new Response('ARCNAVE is waking up or restarting. Please try again in a minute.', { status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } });
    }
    const out = new Response(res.body, res);
    // only a real answer is kept: never an error, a "not yet" (204), or a page Hugging Face shows while the Space wakes up
    const type = res.headers.get('Content-Type') || '';
    if (rule && res.status === 200 && !/text\/html/i.test(type)) {
      const keep = new Response(out.clone().body, out);
      keep.headers.delete('Set-Cookie');
      keep.headers.set('Cache-Control', `public, max-age=${rule.ttl || maxAge(res) || 86400}`);
      ctx.waitUntil(caches.default.put(key, keep));
      out.headers.set('X-Arcnave-Edge', 'MISS');
    }
    return out;
  }
};

function maxAge(res) {
  const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '');
  return m ? +m[1] : 0;
}
