'use strict';
// Several images per epoch (v0.6): median stack, shape check, and sources seen at one visit only. Synthetic images with
// telescope-blurred stars, an asteroid that moves between visits, and a single hot pixel.
const assert = require('assert');
const F = require('../lib/fits');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; } };

const n = 120;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.2832 * rnd());
const stars = []; for (let i = 0; i < 60; i++) stars.push({ x: 8 + rnd() * (n - 16), y: 8 + rnd() * (n - 16), a: 3 + rnd() * 60 });
// visits: 0 and 1 are 3 minutes apart (one visit), the rest are days apart
const mjds = [100.000, 100.002, 101.0, 102.5, 104.0, 105.5];
// asteroid: about 12 px per day across the field, flux 30 (well above noise 0.3)
const ast = m => ({ x: 20 + 12 * (m - 100), y: 30 + 6 * (m - 100) });
const psf = (x, y, s) => s.a * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * 1.1 ** 2));
function frame(k, extra) {
  const v = new Float32Array(n * n), m = mjds[k], A = { ...ast(m), a: 30 };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0.3 * gauss() * (0.9 + 0.2 * (k % 3) / 2);   // slightly different noise per image
    for (const st of stars) if (Math.abs(x - st.x) < 6 && Math.abs(y - st.y) < 6) s += psf(x, y, st) * (0.8 + 0.1 * k);   // different colour = flux
    if (Math.abs(x - A.x) < 6 && Math.abs(y - A.y) < 6) s += psf(x, y, A);
    v[y * n + x] = s;
  }
  if (extra) extra(v);
  return { flat: v, st: F.robustStats(v), touched: null, mjd: m };
}
// put the asteroid away from stars so the test is about the method, not blending
for (const m of mjds) { const p = ast(m); for (let i = stars.length - 1; i >= 0; i--) if (Math.hypot(stars[i].x - p.x, stars[i].y - p.y) < 6) stars.splice(i, 1); }
const HOT = { x: 90, y: 90 };
for (let i = stars.length - 1; i >= 0; i--) if (Math.hypot(stars[i].x - HOT.x, stars[i].y - HOT.y) < 6) stars.splice(i, 1);
const frames = mjds.map((m, k) => frame(k, k === 3 ? v => { v[HOT.y * n + HOT.x] += 40; } : null));

t('medianStack keeps stars, removes the moving asteroid and the hot pixel', () => {
  const S = F.medianStack(frames.map(f => f.flat), n);
  const st = F.robustStats(S.flat);
  const bright = stars.filter(s => s.a > 20)[0];
  assert.ok(F.snrAt(S.flat, n, st, bright.x, bright.y) > 20, 'star kept');
  for (const m of mjds.slice(2)) { const p = ast(m); assert.ok(F.snrAt(S.flat, n, st, p.x, p.y) < 5, 'asteroid at ' + m + ' removed: ' + F.snrAt(S.flat, n, st, p.x, p.y)); }
  assert.ok(F.snrAt(S.flat, n, st, HOT.x, HOT.y) < 5, 'hot pixel removed');
  assert.ok(S.count.every(c => c === 6));
  // a pixel with data in fewer than 3 images stays empty
  const few = F.medianStack([frames[0].flat, frames[1].flat.map((v, i) => i === 0 ? v : NaN)], n, { minValid: 2 });
  assert.ok(few.flat[0] === few.flat[0] && few.flat[1] !== few.flat[1]);
});

t('shape: stars are blurred, a hot pixel is far sharper', () => {
  const ref = F.starShapeMedian(frames[3].flat, n, frames[3].st);
  assert.ok(ref && ref.n >= 8 && ref.median > 0.4 && ref.median < 0.9, JSON.stringify(ref));
  const hot = F.peakShape(frames[3].flat, n, HOT.x, HOT.y);
  assert.ok(hot < 0.1, 'hot pixel shape ' + hot);
  const p = ast(mjds[3]), a = F.peakShape(frames[3].flat, n, p.x, p.y);
  assert.ok(a > 0.5 * ref.median, 'asteroid is as blurred as a star: ' + a);
});

t('singleVisitSources finds the asteroid at each visit, not stars, not the hot pixel', () => {
  for (let j = 0; j < frames.length; j++) {
    const r = F.singleVisitSources(frames, j, n, { edgePx: 2 });
    const p = ast(mjds[j]), hit = r.sources.find(s => Math.hypot(s.x - p.x, s.y - p.y) < 1.5);
    assert.ok(hit, `asteroid in image ${j}: ` + JSON.stringify(r.sources.slice(0, 3)));
    assert.ok(r.sources.length <= 2, `only the asteroid (and maybe noise) in image ${j}: ${r.sources.length}`);
    assert.ok(!r.sources.some(s => Math.hypot(s.x - HOT.x, s.y - HOT.y) < 2), 'hot pixel never reported');
    if (j < 2) assert.strictEqual(hit.matesSeen, 1, 'the other image of the same visit also shows it');
    if (j === 3) assert.ok(r.sharp >= 1, 'hot pixel rejected by shape');
    assert.ok(r.starLike >= 20, 'stars recognised as fixed: ' + r.starLike);
  }
});

t('singleVisitSources needs two other visits', () => {
  const r = F.singleVisitSources(frames.slice(0, 3), 0, n);
  assert.strictEqual(r.sources.length, 0); assert.strictEqual(r.others, 1);
});

console.log(`\n${passed} passed`);
