// SkyBoT unreachable -> the MPC checker answers instead: objects come back with source "MPC", one MPC query serves every
// image within an hour (shifted along the motion), a saved SkyBoT answer still wins, and a working SkyBoT is not replaced.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpcfb-')); process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_SKYBOT_TIMEOUT_MS = '500'; process.env.SKYSHIFT_RETRY_MS = '20';
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpc-lindbloom.html'), 'utf8');
const realFetch = global.fetch; let imcce = 0, mpc = 0, bodies = [];
global.fetch = (url, o) => {
  const u = String(url);
  if (/imcce/.test(u)) { imcce++; return new Promise((_, no) => o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))); }
  if (/minorplanetcenter/.test(u)) { mpc++; bodies.push(String(o.body)); return new Promise(r => setTimeout(() => r(new Response(html, { status: 200 })), 30)); }
  return realFetch(url, o);
};
const server = require('../server'), T = server._test;
(async () => {
  const q = mjd => ({ ra: '189.957', dec: '-4.182', radius: '0.38', mjd: String(mjd) });
  const base = 61196.6787;
  // 12 images: 8 within 40 minutes of the first, 4 a day later
  const t = Date.now();
  const mjds = [...Array.from({ length: 8 }, (_, k) => base + k * 0.005), ...Array.from({ length: 4 }, (_, k) => base + 1 + k * 0.01)];
  const rs = await Promise.all(mjds.map(m => T.movers(q(m))));
  assert.ok(rs.every(r => r.source === 'MPC' && r.items.length > 0), 'every answer from MPC');
  assert.strictEqual(mpc, 2, 'two MPC queries for 12 images (two visits): ' + mpc);
  const b0 = new URLSearchParams(bodies[0]);
  assert.strictEqual(b0.get('year'), '2026'); assert.strictEqual(b0.get('month'), '06'); { const d = +b0.get('day'); assert.ok((d >= 5.6786 && d <= 5.7138) || (d >= 6.6786 && d <= 6.7088), 'time sent is one of the images of a visit: ' + b0.get('day')); }   // whichever request of the hour arrives first
  assert.strictEqual(b0.get('ra'), '12 39 49.7'); assert.strictEqual(b0.get('decl'), '-04 10 55.2'); assert.strictEqual(b0.get('radius'), '23');
  // Lindbloom 17"/h east: 35 minutes later it is 9.9" further east
  const L0 = rs[0].items.find(o => o.num === 3865), L7 = rs[7].items.find(o => o.num === 3865);
  const dx = (L7.ra - L0.ra) * Math.cos(L0.dec * Math.PI / 180) * 3600;
  assert.ok(Math.abs(dx - 17 * 7 * 0.005 * 24) < 0.05, 'shifted along its motion: ' + dx.toFixed(2) + '"');
  assert.strictEqual(L0.cls, null); assert.strictEqual(L0.err, 2);
  // again: from the disk cache, no new MPC queries
  const mpc0 = mpc; await Promise.all(mjds.map(m => T.movers(q(m)))); assert.strictEqual(mpc, mpc0, 'second run needs no MPC query');
  // a saved SkyBoT answer is preferred over MPC
  const crypto = require('crypto'), key = '189.957,-4.182,0.38,' + (61300 + 2400000.5).toFixed(4);
  const file = path.join(TMP, 'api', 'movers-' + crypto.createHash('sha1').update(key).digest('hex') + '.json');
  fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), key, data: { mjd: 61300, count: 1, items: [{ name: 'FromSkyBoT' }] } }));
  const sk = await T.movers(q(61300)); assert.strictEqual(sk.items[0].name, 'FromSkyBoT'); assert.ok(!sk.source);
  // MPC down as well: one clear 503 and it stops asking for 2 minutes
  mpc = 0; global.fetch = (url, o) => { if (/minorplanetcenter/.test(String(url))) { mpc++; return Promise.reject(new Error('fetch failed')); } return /imcce/.test(String(url)) ? Promise.reject(new Error('fetch failed')) : realFetch(url, o); };
  const bad = await Promise.allSettled([61400, 61400.5, 61401].map(m => T.movers(q(m))));
  assert.ok(bad.every(r => r.status === 'rejected' && r.reason.status === 503 && /Neither SkyBoT nor/.test(r.reason.message)), 'both down: clear 503');
  assert.ok(mpc <= 4, 'MPC not hammered: ' + mpc);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  MPC fallback: 12 images -> ${2} MPC queries (${Date.now() - t} ms), shifted along motion, cached, SkyBoT answer preferred, both-down 503`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
