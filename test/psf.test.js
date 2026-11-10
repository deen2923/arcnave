'use strict';
// Empirical PSF (lib/fits.js empiricalPSF / injectPSF). Synthetic field with a known Gaussian PSF, then the REAL SPHEREx
// fixture cutouts. The key promise for "Hide Planet X": a fake source made with the measured PSF has the same shape
// (peakShape) as the image's real stars, so the detector's shape check treats it like a real point source.
// Run: node test/psf.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), F = require('../lib/fits.js');
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok ', name); };
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// --- synthetic: 120 stars, Gaussian sigma 1.1 px (FWHM 2.59 px), random sub-pixel positions, noise 1
const n = 160, SIG = 1.1, FWHM = 2.3548 * SIG;
const gaussPix = (x, y, x0, y0) => {   // pixel-integrated Gaussian, like a real detector
  const e = (u, s) => 0.5 * (1 + erf(u / (Math.SQRT2 * s)));
  return (e(x + 0.5 - x0, SIG) - e(x - 0.5 - x0, SIG)) * (e(y + 0.5 - y0, SIG) - e(y - 0.5 - y0, SIG));
};
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const syn = new Float32Array(n * n); for (let p = 0; p < syn.length; p++) syn[p] = gauss();
const stars = []; for (let k = 0; k < 120; k++) stars.push([8 + rnd() * (n - 16), 8 + rnd() * (n - 16), 300 + rnd() * 4000]);
for (const [x0, y0, f] of stars) for (let y = Math.floor(y0) - 7; y <= y0 + 7; y++) for (let x = Math.floor(x0) - 7; x <= x0 + 7; x++) syn[y * n + x] += f * gaussPix(x, y, x0, y0);
const sst = F.robustStats(syn), P = F.empiricalPSF(syn, n, sst);

t('synthetic: PSF found from many stars, sums to 1, peak at the centre', () => {
  assert.ok(P && P.nStars >= 15, JSON.stringify(P && { n: P.nStars, c: P.nCandidates }));
  const sum = P.psf.reduce((s, v) => s + v, 0); assert.ok(Math.abs(sum - 1) < 1e-5, 'sum ' + sum);
  const mx = P.psf.indexOf(Math.max(...P.psf)); assert.strictEqual(mx, P.half * P.size + P.half);
});
t(`synthetic: measured FWHM matches the true ${FWHM.toFixed(2)} px within 15 % (the pixel itself widens it: 2.68 px for a pixel-integrated Gaussian)`, () => {
  console.log(`     measured ${P.fwhm.toFixed(2)} px from ${P.nStars} stars`);
  assert.ok(P.fwhm > FWHM * 0.95 && P.fwhm < FWHM * 1.15, P.fwhm);
});
t('synthetic: a fake injected with the PSF has the same shape as the real stars, and the right total light', () => {
  const blank = new Float32Array(n * n), fake = F.injectPSF(blank, n, P, 80.37, 80.71, 1000);
  let tot = 0; for (const v of fake) tot += v; assert.ok(Math.abs(tot - 1000) < 1, 'total ' + tot);
  const ref = F.starShapeMedian(syn, n, sst), q = F.peakShape(fake, n, 80.37, 80.71);
  console.log(`     fake shape ${q.toFixed(3)}, stars ${ref.median.toFixed(3)}`);
  assert.ok(Math.abs(q - ref.median) < 0.12 * ref.median, q + ' vs ' + ref.median);
});

// --- REAL SPHEREx cutouts (test/fixtures, D4) and, when present, the 24 real D6 images of the demo field
const FX = path.join(__dirname, 'fixtures'), meta = JSON.parse(fs.readFileSync(path.join(FX, 'real_pair.json'), 'utf8'));
const PX = 6.15 / 3600, fld = meta.field, rn = Math.round(fld.size / PX), grid = { ra0: fld.ra, dec0: fld.dec, s: PX, n: rn };
const load = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const real = [meta.files.A, meta.files.B].map(f => F.prepareCutout(load(path.join(FX, f)), grid));
// shapes of the image's bright stars (same rule as F.starShapeMedian), with the standard error of their median
function starShapes(v, m, st) {
  const lim = st.med + 30 * st.sigma, r = [];
  for (let y = 3; y < m - 3; y++) for (let x = 3; x < m - 3; x++) { const c = v[y * m + x]; if (!(c > lim)) continue;
    let mx = true; for (let j = -1; j <= 1 && mx; j++) for (let i = -1; i <= 1; i++) if ((i || j) && v[(y + j) * m + x + i] >= c) { mx = false; break; }
    if (mx) { const q = F.peakShape(v, m, x, y); if (q != null) r.push(q); } }
  r.sort((p, q) => p - q); const med = r[r.length >> 1], mad = r.map(x => Math.abs(x - med)).sort((p, q) => p - q)[r.length >> 1];
  return { med, n: r.length, se: 1.4826 * mad * 1.25 / Math.sqrt(r.length) };
}
// inject 40 fakes at blank spots (one at a time) and compare their median shape with the real stars'
function fakeCheck(img, m, Pr, label) {
  const ref = starShapes(img.flat, m, img.st), peaks = F.detectPeaks(img.flat, m, img.st, 3, 5000), shapes = [], blank = new Float32Array(m * m);
  for (let k = 0; k < 800 && shapes.length < 40; k++) {
    const x = 12 + rnd() * (m - 24), y = 12 + rnd() * (m - 24);
    if (peaks.some(p => Math.hypot(p.x - x, p.y - y) < 8)) continue;
    shapes.push(F.peakShape(F.injectPSF(blank, m, Pr, x, y, 1000), m, x, y));
  }
  shapes.sort((p, q) => p - q); const fm = shapes[shapes.length >> 1], ok = Math.abs(fm - ref.med) < Math.max(0.1 * ref.med, 2.5 * ref.se);
  console.log(`     ${label}: FWHM ${Pr.fwhm.toFixed(2)} px (${(Pr.fwhm * 6.15).toFixed(1)}"), ePSF from ${Pr.nStars} stars, ${(100 * Pr.peakFrac).toFixed(0)} % of the light in the peak pixel; fake shape ${fm.toFixed(3)} vs ${ref.n} stars ${ref.med.toFixed(3)} ± ${ref.se.toFixed(3)} ${ok ? 'ok' : 'OFF'}`);
  return { fm, ref, ok };
}
t('REAL D4 cutouts: PSF from real stars; fakes look like the real stars', () => {
  real.forEach((img, i) => {
    const Pr = F.empiricalPSF(img.flat, rn, img.st); assert.ok(Pr && Pr.nStars >= 10, 'stars ' + (Pr && Pr.nStars));
    assert.ok(Pr.fwhm > 1 && Pr.fwhm < 5, 'FWHM px ' + Pr.fwhm);
    assert.ok(fakeCheck(img, rn, Pr, 'D4 ' + 'AB'[i]).ok);
  });
});
const DEMO = path.join(__dirname, '..', 'demo-cache', 'cutouts');
if (fs.existsSync(DEMO)) t('REAL D6 demo field, 24 images: per-image PSF; fakes match the stars (the PSF differs image to image)', () => {
  const zlib = require('zlib'), g = { ra0: 189.957, dec0: -4.182, s: PX, n: Math.round(0.5 / PX) }, rows = [];
  for (const f of fs.readdirSync(DEMO)) {
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(DEMO, f))), img = F.prepareCutout(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), g);
    const Pr = F.empiricalPSF(img.flat, g.n, img.st); assert.ok(Pr, 'no PSF for ' + f);
    rows.push(Object.assign(fakeCheck(img, g.n, Pr, 'D6 ' + f.slice(0, 6)), { fwhm: Pr.fwhm }));
  }
  const good = rows.filter(r => r.ok).length, ratio = rows.reduce((s, r) => s + r.fm / r.ref.med, 0) / rows.length;
  const starMeds = rows.map(r => r.ref.med); console.log(`     ${good}/${rows.length} match; mean fake/star shape ${ratio.toFixed(3)} (fakes slightly softer = slightly harder to detect: a cautious test); star shapes range ${Math.min(...starMeds).toFixed(2)}-${Math.max(...starMeds).toFixed(2)}`);
  assert.ok(good >= rows.length - 2, `${good} of ${rows.length}`); assert.ok(ratio > 0.9 && ratio < 1.15, 'ratio ' + ratio);
});
console.log(`\n${pass} passed`);
