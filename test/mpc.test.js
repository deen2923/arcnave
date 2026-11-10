// The MPC MPChecker fallback: the parser reads the real reply, positions agree with the SkyBoT answer that ships with the demo
// data, and objects can be moved along their motion to another time.
const fs = require('fs'), path = require('path'), assert = require('assert');
const P = require('../lib/parsers');
const txt = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpc-lindbloom.html'), 'utf8');
const r = P.parseMpc(txt);
assert.ok(r.ok && r.items.length === 8, 'eight rows read: ' + r.items.length);
const L = r.items[0];
assert.strictEqual(L.num, 3865); assert.strictEqual(L.name, 'Lindbloom'); assert.strictEqual(L.vmag, 16.8);
assert.ok(Math.abs(L.ra - (12 + 39 / 60 + 48.0 / 3600) * 15) < 1e-9 && Math.abs(L.dec - -(4 + 12 / 60 + 30 / 3600)) < 1e-9, 'Lindbloom position');
assert.strictEqual(L.dra, 17); assert.strictEqual(L.ddec, 0);
const S = r.items[1]; assert.strictEqual(S.num, null); assert.strictEqual(S.name, '2005 SL39'); assert.strictEqual(S.dra, 7); assert.strictEqual(S.ddec, -3);
assert.strictEqual(r.items[6].num, 65613); assert.strictEqual(r.items[6].name, '3923 T-3');
assert.strictEqual(r.items[7].name, '2026 EM53');
// same field and time as the shipped SkyBoT answer (key 189.957,-4.182,0.38,2461197.1787): the two services agree
const demo = path.join(__dirname, '..', 'demo-cache', 'api');
let sky = null;
for (const f of fs.readdirSync(demo)) { if (!f.startsWith('movers-')) continue; const j = JSON.parse(fs.readFileSync(path.join(demo, f), 'utf8')); if (j.key === '189.957,-4.182,0.38,2461197.1787') sky = j.data; }
if (sky) {
  const arc = (a, b) => Math.hypot((a.ra - b.ra) * Math.cos(a.dec * Math.PI / 180), a.dec - b.dec) * 3600;
  let n = 0;
  for (const o of r.items) { const s = sky.items.find(x => x.name === o.name); if (!s) continue; n++; assert.ok(arc(o, s) < 3, `${o.name}: MPC and SkyBoT within 3": ${arc(o, s).toFixed(2)}`); }
  assert.ok(n >= 6, 'compared ' + n + ' objects');
}
// empty and broken replies
assert.deepStrictEqual(P.parseMpc('No known minor planets, brighter than <i>V</i> = 22.0, were found in the  12.0-arcminute region around R.A. = 10 00 00').items, []);
assert.ok(P.parseMpc('No known minor planets, brighter than V = 22.0, were found in the 12.0-arcminute region').ok);
assert.ok(!P.parseMpc('<html>Internal Server Error</html>').ok, 'error page is an error, not 0 objects');
assert.ok(!P.parseMpc('The following objects were found\n x 12 39 48.0 -04 12 30 garbage').ok, 'unreadable rows are an error');
// moving to another time: 17"/h east for 0.5 h at Dec -4 is 8.5" in R.A.
const m = P.shiftItems([L], 0.5)[0];
assert.ok(Math.abs((m.ra - L.ra) * Math.cos(L.dec * Math.PI / 180) * 3600 - 8.5) < 0.05, 'shifted 8.5"');
console.log('ok  MPC parser: 8 real rows, agrees with SkyBoT, empty/broken replies, time shift');
