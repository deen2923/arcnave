// v0.21: the page must work when CDS (France) cannot be reached. Base-sky tiles come through /hips/<sky>/... from the first
// mirror that answers and are kept on disk; names resolve through NASA NED when Sesame is down. Network mocked.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-')); process.env.SKYSHIFT_CACHE_DIR = TMP;
const realFetch = global.fetch, calls = [];
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
global.fetch = (url, o) => {
  const u = String(url); if (/127\.0\.0\.1/.test(u)) return realFetch(url, o);
  calls.push(u);
  const never = () => new Promise((_, no) => o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  if (/irsa\.ipac/.test(u)) return Promise.resolve(new Response('Service Unavailable', { status: 503 }));   // first mirror down
  if (/casda\.csiro/.test(u)) {
    if (/Npix999\.jpg/.test(u)) return Promise.resolve(new Response('nope', { status: 404 }));
    if (/properties$/.test(u)) return Promise.resolve(new Response('hips_order = 9\nhips_tile_format = jpeg\n', { status: 200 }));
    return Promise.resolve(new Response(JPG, { status: 200 }));
  }
  if (/cds\.unistra\.fr|u-strasbg/.test(u)) return never();   // France unreachable: hangs until the timeout
  if (/ned\.ipac\.caltech\.edu\/srs\/ObjectLookup/.test(u)) {
    const name = JSON.parse(decodeURIComponent(String(o.body).replace(/^json=/, ''))).name.v;
    return Promise.resolve(new Response(JSON.stringify(name === 'M42' ? { Supplied: 'M42', Preferred: { Name: 'MESSIER 042', Position: { RA: 83.81866208, Dec: -5.389678889 } }, StatusCode: 100, ResultCode: 3 } : { StatusCode: 100, ResultCode: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return Promise.reject(new Error('unexpected ' + u));
};
const server = require('../server');
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await realFetch(base + '/hips/2mass/properties'); assert.strictEqual(r.status, 200); assert.ok(/hips_order/.test(await r.text()));
  assert.strictEqual(r.headers.get('x-arcnave-from'), 'casda.csiro.au', 'second mirror used when the first fails');
  r = await realFetch(base + '/hips/2mass/Norder3/Dir0/Npix100.jpg'); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
  const n = calls.length;
  r = await realFetch(base + '/hips/2mass/Norder3/Dir0/Npix100.jpg'); assert.strictEqual(r.headers.get('x-arcnave-from'), 'disk'); assert.strictEqual(calls.length, n, 'second time from disk');
  r = await realFetch(base + '/hips/2mass/Norder3/Dir0/Npix999.jpg'); assert.strictEqual(r.status, 404, 'missing tile is 404');
  for (const bad of ['/hips/2mass/../../server.js', '/hips/evil/properties', '/hips/2mass/Norder3/Dir0/x.txt', '/hips/2mass/Norder3/Dir0/Npix1.jpg?x=1']) {
    r = await realFetch(base + bad); assert.ok(r.status === 404 || r.status === 400 || r.status === 200 && bad.includes('?'), bad + ' -> ' + r.status);
  }
  assert.ok(!calls.some(u => /\.\.|evil/.test(u)), 'no odd upstream requests');
  // names: Sesame (France) hangs -> NED answers; the next lookup skips Sesame at once
  let t = Date.now(); r = await realFetch(base + '/api/resolve?q=M42'); const j = await r.json();
  assert.strictEqual(r.status, 200); assert.ok(Math.abs(j.ra - 83.8187) < 1e-3 && Math.abs(j.dec + 5.3897) < 1e-3 && j.source === 'NED', JSON.stringify(j));
  const first = Date.now() - t; t = Date.now();
  r = await realFetch(base + '/api/resolve?q=xyzzy'); assert.strictEqual(r.status, 404);
  const second = Date.now() - t;
  assert.ok(second < 3000, 'Sesame skipped while down: ' + second + ' ms');
  server.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  CDS unreachable: sky tiles from the next mirror and then from disk, bad paths refused; M42 via NED in ${first} ms, next lookup ${second} ms`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
