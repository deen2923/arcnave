// The page reads new images from S3 itself: "cached=1" must answer 204 without downloading anything, a cutout the page
// posts back is kept (local runs only) and served next time, and junk is refused.
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cput-')); process.env.SKYSHIFT_CACHE_DIR = TMP;
const realFetch = global.fetch; let upstream = 0;
global.fetch = (url, o) => { if (!/127\.0\.0\.1/.test(String(url))) { upstream++; return Promise.reject(new Error('no network in this test')); } return realFetch(url, o); };
const server = require('../server');
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const q = 'url=' + encodeURIComponent('https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/x/y/level2_test.fits') + '&ra=10&dec=20&size=0.5';
  let r = await realFetch(`${base}/api/spherex/cutout?${q}&cached=1`);
  assert.strictEqual(r.status, 204); assert.strictEqual(upstream, 0, 'nothing downloaded for cached=1');
  r = await realFetch(`${base}/api/spherex/cutout?${q}`, { method: 'POST', body: 'SIMPLE  = junk' });
  assert.strictEqual(r.status, 400, 'junk refused');
  const dir = path.join(__dirname, '..', 'demo-cache', 'cutouts');
  const fits = zlib.gunzipSync(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.gz')).sort()[0])));
  r = await realFetch(`${base}/api/spherex/cutout?${q}`, { method: 'POST', body: fits });
  assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).saved, true);
  r = await realFetch(`${base}/api/spherex/cutout?${q}&cached=1`);
  assert.strictEqual(r.status, 200); const back = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(Buffer.compare(back, fits), 0, 'served back byte for byte');
  r = await realFetch(`${base}/lib/s3cut.js`); assert.strictEqual(r.status, 200, 'page can load lib/s3cut.js');
  assert.strictEqual(upstream, 0);
  server.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log('ok  page-read S3 cutouts: cached=1 gives 204 without downloading, posted cutout kept and served back, junk refused');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
