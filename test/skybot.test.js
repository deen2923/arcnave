// SkyBoT not answering must not hold the Analyst (or the IRSA downloads) for minutes: first lookup fails within the timeout,
// the rest fail at once while the breaker is open, a saved answer is still served, and the shared download slots stay free.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skybot-')); process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_SKYBOT_TIMEOUT_MS = '800'; process.env.SKYSHIFT_RETRY_MS = '50';
const realFetch = global.fetch; let calls = 0;
global.fetch = (url, o) => { if (/minorplanetcenter/.test(String(url))) return Promise.reject(Object.assign(new Error('fetch failed'), { cause: 'no route' }));   // the MPC fallback is down too (see mpcfallback.test.js for it working)
  if (/imcce/.test(String(url))) { calls++; return new Promise((_, no) => o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))); } return realFetch(url, o); };
const server = require('../server'), T = server._test;
(async () => {
  const q = mjd => ({ ra: '150.12', dec: '2.21', radius: '0.375', mjd: String(mjd) });
  // 24 lookups at once (one per image), as the Analyst asks: all done within about one timeout, not 24 x 60 s
  let t = Date.now();
  const all = await Promise.allSettled(Array.from({ length: 24 }, (_, k) => T.movers(q(60799 + k / 50))));
  const first = Date.now() - t;
  assert.ok(all.every(r => r.status === 'rejected' && r.reason.status === 503 && /Neither SkyBoT nor/.test(r.reason.message)), 'every lookup: clear 503 (both services down)');
  assert.ok(first < 2500, '24 lookups give up within about one timeout (0.8 s here): ' + first + ' ms');
  // at most one pool's worth reached SkyBoT (v0.43.1 raised the pool from 4 to 6); the rest failed on the breaker
  assert.ok(calls <= T.SKYBOT.max, `only the first few reached SkyBoT: ${calls} (pool ${T.SKYBOT.max})`); calls = 0;
  t = Date.now(); const rs = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => T.movers(q(60800.1 + k / 100))));
  const rest = Date.now() - t;
  assert.ok(rs.every(r => r.status === 'rejected' && r.reason.status === 503), 'the others fail too');
  assert.ok(rest < 200, 'while the breaker is open they fail at once: ' + rest + ' ms');
  assert.strictEqual(calls, 0, 'SkyBoT not asked while the breaker is open: ' + calls);
  // a saved answer is still served while SkyBoT is down
  const key = '150.120,2.210,0.38,' + (60801 + 2400000.5).toFixed(4), file = path.join(TMP, 'api', 'movers-' + require('crypto').createHash('sha1').update(key).digest('hex') + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), key, data: { mjd: 60801, count: 1, items: [{ name: 'Test' }] } }));
  const saved = await T.movers(q(60801));
  assert.strictEqual(saved.items[0].name, 'Test', 'saved answer served');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  SkyBoT down: 24 lookups gave up in ${first} ms, 10 more in ${rest} ms, saved answers still served`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
