// v0.53: /api/catwise asks IRSA for CatWISE2020 (positions at MJD 57170, motions in arcsec/yr with cos(dec)), sends one
// compact array per source, keeps the answer (a second ask does not reach IRSA) and refuses bad input. Rows: real CatWISE2020
// rows around WISE 0855 (IRSA TAP, 7 Nov 2026), including two of its entries and one blank cell.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'catwise-')); process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_RETRY_MS = '20';
const CSV = [
  'source_name,ra_pm,dec_pm,pmra,pmdec,sigpmra,sigpmdec,w1mpro,w2mpro,w2snr,nb,ab_flags',
  'J085506.91-071437.5,133.7835555,-7.2440520,-7.91990,0.49390,0.1520,0.2353,19.456,15.541,24.0,1,00',
  'J085507.96-071439.3,133.7839240,-7.2443404,-8.02120,1.03570,0.0892,0.1412,19.577,15.787,20.2,3,00',
  'J085511.28-071528.3,133.7970018,-7.2578625,-0.01233,-0.01930,0.0043,0.0048,11.995,12.025,96.9,2,00',
  'J085505.63-071527.3,133.7734320,-7.2575456,-0.19188,0.01920,0.2326,0.2674,18.421,18.035,,1,00',
  ',,,,,,,,,,,'].join('\n');
const realFetch = global.fetch; let calls = 0, lastUrl = '';
global.fetch = (url, o) => { const u = String(url);
  if (/irsa\.ipac\.caltech\.edu\/TAP/.test(u)) { calls++; lastUrl = u; return Promise.resolve(new Response(CSV, { status: 200, headers: { 'Content-Type': 'text/csv' } })); }
  return realFetch(url, o); };
const T = require('../server')._test;
(async () => {
  const q = { ra: '133.78627', dec: '-7.24440', r: '0.18' };
  const a = await T.catwise(q);
  assert.strictEqual(calls, 1, 'one IRSA query');
  const adql = decodeURIComponent(lastUrl.split('QUERY=')[1]);
  assert.ok(/FROM catwise_2020/.test(adql) && /CIRCLE\('ICRS', 133\.78627, -7\.2444, 0\.18\)/.test(adql) && /w2snr > 5/.test(adql), 'asks catwise_2020 in the right circle: ' + adql);
  assert.strictEqual(a.epochMjd, 57170); assert.strictEqual(a.via, 'IRSA');
  assert.deepStrictEqual(a.cols, ['name', 'ra', 'dec', 'pmra', 'pmdec', 'spmra', 'spmdec', 'w1', 'w2', 'snr', 'nb', 'ab']);
  assert.strictEqual(a.src.length, 4, 'the empty row is dropped');
  const o = Object.fromEntries(a.cols.map((k, i) => [k, a.src[0][i]]));
  assert.strictEqual(o.name, 'J085506.91-071437.5'); assert.strictEqual(o.pmra, -7.9199); assert.strictEqual(o.pmdec, 0.4939);
  assert.strictEqual(o.nb, 1); assert.strictEqual(o.ab, '00'); assert.ok(Math.abs(o.w1 - o.w2 - 3.915) < 1e-9, 'W1-W2 of WISE 0855');
  assert.strictEqual(a.src[3][9], null, 'a blank S/N stays null');
  const b = await T.catwise(q);
  assert.strictEqual(calls, 1, 'the second ask is answered from the cache'); assert.deepStrictEqual(b.src, a.src);
  await assert.rejects(T.catwise({ ra: '400', dec: '0' }), e => e.status === 400, 'RA out of range is refused');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  CatWISE2020: IRSA asked once (catwise_2020, circle, S/N > 5), ${a.src.length} sources sent compact, WISE 0855's motion and colour intact, cached, bad input refused`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
