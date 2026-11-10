'use strict';
// "Changes" view maths (lib/fits.js changeMaps) on a synthetic field: 3 epochs x 3 images.
// Stars in every image; a mover at a new spot in each image of epoch 2; a cosmic ray (one sharp pixel) in one image;
// a source that appears in every image of epoch 3. Run: node test/change.test.js
const assert = require('assert'), F = require('../lib/fits.js');
const n = 64, N = n * n;
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function addPsf(a, x0, y0, amp) { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] += amp * Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * 0.9 ** 2)); }
const MOVER = [[20.3, 40.2], [24.1, 40.9], [28.2, 41.6]], CR = { e: 0, j: 1, x: 45, y: 12 }, CRK = { e: 0, j: 2, x: 50, y: 30 }, NEW = [12.2, 50.1];
const busy = [...MOVER, [CR.x, CR.y], [CRK.x, CRK.y], NEW];   // keep the test objects off the stars
const stars = []; while (stars.length < 25) { const s = [6 + rnd() * 52, 6 + rnd() * 52, 3 + rnd() * 20]; if (busy.every(b => Math.hypot(b[0] - s[0], b[1] - s[1]) > 5)) stars.push(s); }
const frames = [], byEpoch = [[], [], []];
for (let e = 0; e < 3; e++) for (let j = 0; j < 3; j++) {
  const a = new Float32Array(N); for (let p = 0; p < N; p++) a[p] = 0.1 * gauss();
  for (const s of stars) addPsf(a, s[0], s[1], s[2]);
  if (e === 1) addPsf(a, MOVER[j][0], MOVER[j][1], 4);
  if (e === 2) addPsf(a, NEW[0], NEW[1], 5);
  if (e === CR.e && j === CR.j) a[CR.y * n + CR.x] += 30;   // cosmic ray the pipeline did not flag: in the image itself
  const keep = a.slice(); if (e === CRK.e && j === CRK.j) keep[CRK.y * n + CRK.x] += 30;   // flagged cosmic ray: only in the "kept" copy (MP_OUTLIER)
  // epoch 1: three exposures minutes apart (one visit); epochs 2 and 3: one image a day (the mover moves 4 px a day)
  const mjd = 61000 + 180 * e + (e === 0 ? j * 0.004 : j);
  const f = { flat: a, keep, st: F.robustStats(a), mjd }; frames.push(f); byEpoch[e].push(f);
}
const stacks = byEpoch.map(fs => { const m = F.medianStack(fs.map(f => f.flat), n, {}).flat; return { flat: m, st: F.robustStats(m) }; });
const r = F.changeMaps(stacks, frames, n, { nsig: 8 });
const px = (rgba, x, y) => { const o = (Math.round(y) * n + Math.round(x)) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2]]; };
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok ', name); };

t('epoch colours add up to white for 2, 3 and 5 epochs', () => {
  for (const E of [2, 3, 5]) { const c = F.epochColours(E); for (let j = 0; j < 3; j++) assert.ok(Math.abs(c.reduce((s, x) => s + x[j], 0) - 1) < 1e-9, `E=${E} channel ${j}`); }
});
t('a star present in every epoch is white; the new source of epoch 3 is red', () => {
  const s = stars.reduce((m, x) => x[2] > m[2] ? x : m), w = px(r.epochRGBA, s[0], s[1]);
  assert.ok(Math.min(...w) > 150 && Math.max(...w) - Math.min(...w) < 40, 'star should be white-ish: ' + w);
  const q = px(r.epochRGBA, NEW[0], NEW[1]);
  assert.ok(q[0] > 120 && q[1] < 40 && q[2] < 40, 'new source should be red: ' + q);
});
t('the mover leaves one peak per image of epoch 2, in time order', () => {
  for (let j = 0; j < 3; j++) {
    const k = 3 + j, pk = r.peaks.find(p => Math.hypot(p.x - MOVER[j][0], p.y - MOVER[j][1]) < 1.6);
    assert.ok(pk, 'mover peak ' + j); assert.strictEqual(pk.k, k, 'image index'); assert.strictEqual(pk.sharp, false, JSON.stringify(pk)); assert.strictEqual(pk.onStar, false, JSON.stringify(pk));
  }
});
t('an unflagged cosmic ray is one peak in its image, missing from the exposures minutes apart: an artefact', () => {
  const pk = r.peaks.find(p => Math.hypot(p.x - CR.x, p.y - CR.y) <= 1);
  assert.ok(pk && pk.k === CR.e * 3 + CR.j && pk.repeat === false, JSON.stringify(pk));
  assert.ok(r.sharpCounts[CR.e * 3 + CR.j] >= 1);
});
t('a flagged cosmic ray (kept copy only, nothing in the partner exposures) is not shown at all', () => {
  assert.ok(!r.peaks.some(p => Math.hypot(p.x - CRK.x, p.y - CRK.y) <= 2), JSON.stringify(r.peaks.filter(p => Math.hypot(p.x - CRK.x, p.y - CRK.y) <= 2)));
  assert.ok(r.keptDropped >= 1);
});
t('stars that never change leave no peaks', () => {
  const onStars = r.peaks.filter(p => stars.some(s => s[2] > 5 && Math.hypot(p.x - s[0], p.y - s[1]) < 1.5) && !MOVER.some(m => Math.hypot(p.x - m[0], p.y - m[1]) < 2));
  assert.deepStrictEqual(onStars, [], 'no peaks on static stars');
  assert.ok(r.peaks.length <= 7, 'few peaks in all: ' + r.peaks.length);
});
t('time colours run from violet (first image) to red (last)', () => {
  const first = r.hues[0], last = r.hues[r.hues.length - 1];
  assert.ok(first[2] > first[1] && last[0] > 200 && last[2] < 60, JSON.stringify([first, last]));
});
console.log(`\n${pass} passed`);
