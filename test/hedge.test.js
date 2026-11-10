// SkyBoT slow (not down): after the hedge time the MPC checker is asked too and its answer is used, so a lookup takes
// about the hedge time instead of SkyBoT's whole timeout.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hedge-')); process.env.SKYSHIFT_CACHE_DIR = TMP;
process.env.SKYSHIFT_SKYBOT_TIMEOUT_MS = '8000'; process.env.SKYSHIFT_SKYBOT_HEDGE_MS = '300';
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpc-lindbloom.html'), 'utf8');
const realFetch = global.fetch;
global.fetch = (url, o) => {
  const u = String(url);
  if (/imcce/.test(u)) return new Promise((_, no) => o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  if (/minorplanetcenter/.test(u)) return new Promise(r => setTimeout(() => r(new Response(html, { status: 200 })), 50));
  return realFetch(url, o);
};
const T = require('../server')._test;
(async () => {
  const t = Date.now();
  const r = await T.movers({ ra: '189.957', dec: '-4.182', radius: '0.38', mjd: '61196.6787' });
  const ms = Date.now() - t;
  assert.strictEqual(r.source, 'MPC'); assert.ok(r.items.some(o => o.num === 3865));
  assert.ok(ms < 2000, 'answered after the hedge, not the 8 s SkyBoT timeout: ' + ms + ' ms');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  SkyBoT slow: MPC answer after ${ms} ms (hedge 300 ms, SkyBoT timeout 8 s)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
