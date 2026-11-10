'use strict';
// Hide Planet X (lib/planetx.js): the Sun/Earth positions, the parallax of a distant body, brightness units, the PSF
// built from stars, and injection-recovery on a synthetic field. Run: node test/planetx.test.js
const assert = require('assert'), F = require('../lib/fits.js'), X = require('../lib/planetx.js');
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok ', name); };
const mjdOf = iso => Date.parse(iso) / 86400000 + 40587;
const radec = v => { const r = Math.hypot(...v); let ra = Math.atan2(v[1], v[0]) * 180 / Math.PI; if (ra < 0) ra += 360; return { ra, dec: Math.asin(v[2] / r) * 180 / Math.PI, r }; };

t('Sun at the March equinox and June solstice of 2024, and Earth-Sun distance at perihelion', () => {
  const eq = radec(X.sunVector(mjdOf('2024-03-20T03:06:00Z'))), so = radec(X.sunVector(mjdOf('2024-06-20T20:51:00Z')));
  assert.ok(Math.abs(eq.dec) < 0.02 && (eq.ra < 0.05 || eq.ra > 359.95), JSON.stringify(eq));
  assert.ok(Math.abs(so.dec - 23.44) < 0.02 && Math.abs(so.ra - 90) < 0.05, JSON.stringify(so));
  const peri = radec(X.sunVector(mjdOf('2024-01-03T00:39:00Z')));
  assert.ok(Math.abs(peri.r - 0.98331) < 0.0003, JSON.stringify(peri));
});
t('a body 10 million AU away does not move (under 0.05 arcsec in six months)', () => {
  const m0 = mjdOf('2025-06-01T00:00:00Z'), p = X.track(190, -4, 1e7, m0, [m0, m0 + 182.6]);
  assert.ok(X.sepArcsec(p[0], p[1]) < 0.05);
});
t('at the ecliptic pole, 500 AU: opposite sides of the orbit are 2*atan(1 AU/500 AU) = 825 arcsec apart (within 3%)', () => {
  const m0 = mjdOf('2025-06-01T00:00:00Z'), p = X.track(270, 66.5607, 500, m0, [m0, m0 + 182.62]);
  const s = X.sepArcsec(p[0], p[1]), want = 2 * Math.atan(1 / 500) * 206264.8;
  assert.ok(Math.abs(s / want - 1) < 0.03, s + ' vs ' + want);
});
t('on the ecliptic at opposition, 500 AU: about 7.1 arcsec a day (Earth 0.0172 AU/day / 500 AU)', () => {
  // opposition: the body is opposite the Sun. Put it there at m0 and look 1 day later.
  const m0 = mjdOf('2025-09-21T00:00:00Z'), s = radec(X.sunVector(m0)), ra = (s.ra + 180) % 360, dec = -s.dec;
  const p = X.track(ra, dec, 500, m0, [m0, m0 + 1]), rate = X.sepArcsec(p[0], p[1]), want = 0.0172 / 500 * 206264.8;
  assert.ok(Math.abs(rate / want - 1) < 0.05, rate + ' vs ' + want);
  // and it moves backwards (west, RA decreasing): retrograde at opposition
  assert.ok(p[1].ra < p[0].ra, 'retrograde');
});
t('brightness units: AB 0 = 3631 Jy, AB 16.4 = 1 mJy, and mJy -> MJy/sr pixel sum -> mJy round trip', () => {
  assert.ok(Math.abs(X.abToMJy(0) - 3631e3) < 1e-6 && Math.abs(X.mJyToAb(1) - 16.40) < 0.01);
  const s = X.mJyToPixelSum(2.5, 6.15); assert.ok(Math.abs(X.pixelSumToMJy(s, 6.15) - 2.5) < 1e-9);
  // 1 mJy over one 6.15" pixel: Omega = (6.15/206265)^2 sr = 8.89e-10 sr -> 1e-3 Jy / (8.89e-10 sr * 1e6) = 1.125 MJy/sr
  assert.ok(Math.abs(X.mJyToPixelSum(1, 6.15) - 1.1249) < 0.001, X.mJyToPixelSum(1, 6.15));
});

// synthetic field: 2 epochs x 4 images, Gaussian stars (sigma 0.9 px) + noise
const n = 120, N = n * n, grid = { ra0: 200, dec0: -10, s: 6.15 / 3600, n };
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const addG = (a, x0, y0, amp) => { for (let y = Math.max(0, Math.floor(y0 - 6)); y < Math.min(n, y0 + 7); y++) for (let x = Math.max(0, Math.floor(x0 - 6)); x < Math.min(n, x0 + 7); x++) a[y * n + x] += amp * Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * 0.9 ** 2)); };
const stars = []; for (let i = 0; i < 60; i++) stars.push([8 + rnd() * (n - 16), 8 + rnd() * (n - 16), 2 + 60 * rnd() ** 2]);
const t0 = mjdOf('2025-06-01T00:00:00Z');
const epochs = [0, 1].map(e => {
  const frames = [0, 1, 2, 3].map(j => { const a = new Float32Array(N); for (let p = 0; p < N; p++) a[p] = 0.1 * gauss(); for (const s of stars) addG(a, s[0], s[1], s[2]); return { flat: a, mjd: t0 + 182 * e + 0.3 * j }; });
  const m = F.medianStack(frames.map(f => f.flat), n, {}); return { frames, stack: { flat: m.flat, touched: m.touched.map(() => 0), st: F.robustStats(m.flat) } };
});
const ctx = X.makeContext(F, epochs, grid, { maxSep: 1 });

t('PSF from the stars: sum 1, Gaussian-equivalent FWHM near 2.12 px (sigma 0.9), built from at least 5 stars', () => {
  assert.ok(ctx.psf && ctx.psf.nStars >= 5, JSON.stringify(ctx.psf && ctx.psf.nStars));
  const s = ctx.psf.psf.reduce((p, q) => p + q, 0); assert.ok(Math.abs(s - 1) < 1e-6, "sum " + s);   // float32 PSF (SkyFits ePSF)
  assert.ok(ctx.psf.fwhmPx > 1.9 && ctx.psf.fwhmPx < 2.6, 'fwhm ' + ctx.psf.fwhmPx);
});
t('an injected source adds its whole flux (within 3%) wherever it lands between pixels', () => {
  for (const [x, y] of [[50, 50], [50.5, 50.5], [50.3, 49.8]]) { const px = X.sourcePixels(ctx.psf, n, x, y, 10); const s = px.reduce((p, q) => p + q[1], 0); assert.ok(Math.abs(s - 10) < 0.3, x + ',' + y + ': ' + s); }
});
t('no fake planet, no new candidates: the base comparison of static stars is clean', () => {
  assert.deepStrictEqual(ctx.base.cands, []);
});
t('a bright fake planet at 500 AU is recovered in both epochs, at the right places; a very faint one is not', () => {
  const sum = 40 * 0.1 / ctx.psf.peakFrac;   // peak ~40 sigma of one image
  const r = X.trial(ctx, { x: 15, y: 40, dist: 500, mJy: X.pixelSumToMJy(sum, 6.15) });
  assert.ok(r.foundA && r.foundB, JSON.stringify({ a: r.hitA, b: r.hitB, at: r.epochs.map(e => e.at) }));
  assert.ok(Math.hypot(r.hitA.x - 15, r.hitA.y - 40) < 1 && Math.hypot(r.hitB.x - r.epochs[1].at.x, r.hitB.y - r.epochs[1].at.y) < 1, 'epoch a position');
  assert.ok(r.shiftArcsec > 100, 'parallax jump between the passes: ' + r.shiftArcsec);
  const weak = X.trial(ctx, { x: 40, y: 60, dist: 500, mJy: X.pixelSumToMJy(1 * 0.1 / ctx.psf.peakFrac, 6.15) });
  assert.ok(!weak.found, JSON.stringify(weak.hitA));
});
// the same sky with the 4 images of each pass spread over 7.5 days (2.5 days apart), as on many real fields
const epochs2 = [0, 1].map(e => {
  const frames = [0, 1, 2, 3].map(j => { const a = new Float32Array(N); for (let p = 0; p < N; p++) a[p] = 0.1 * gauss(); for (const s of stars) addG(a, s[0], s[1], s[2]); return { flat: a, mjd: t0 + 182 * e + 2.5 * j }; });
  const m = F.medianStack(frames.map(f => f.flat), n, {}); return { frames, stack: { flat: m.flat, touched: m.touched.map(() => 0), st: F.robustStats(m.flat) } };
});
const ctx2 = X.makeContext(F, epochs2, grid, { maxSep: 1 });
t('300 AU over a 7.5-day pass: it moves several pixels, the plain median stack removes it, the motion-following stack finds it', () => {
  const sum = 40 * 0.1 / ctx2.psf.peakFrac, r = X.trial(ctx2, { x: 40, y: 60, dist: 300, mJy: X.pixelSumToMJy(sum, 6.15) });
  assert.ok(r.epochs[0].moveDuringEpochPx > 4, 'moves ' + r.epochs[0].moveDuringEpochPx);
  assert.ok(r.orbitPx[0] <= 1, 'own orbit during the pass ' + r.orbitPx[0]);
  assert.ok(!r.foundA && !r.foundPlain, JSON.stringify(r.hitA));
  assert.ok(r.foundShift && r.found && r.shift.snrA >= 7, JSON.stringify(r.shift));
});
t('30 AU: its own orbit moves it more than a pixel during the pass, so the motion-following stack is not used (a real search could not line it up)', () => {
  const sum = 40 * 0.1 / ctx.psf.peakFrac, r = X.trial(ctx, { x: 40, y: 60, dist: 30, mJy: X.pixelSumToMJy(sum, 6.15) });
  assert.ok(r.orbitPx[0] > 1 && !r.foundShift && !r.found, JSON.stringify({ o: r.orbitPx, s: r.shift }));
});
t('motion-following stack, no fake planet: nothing found anywhere, at any distance (no false alarms on static stars + noise)', () => {
  const pos = X.trialPositions(epochs[0].stack.flat, n, 25, 12, 9); let hits = 0;
  for (const d of [30, 100, 300, 1000]) for (const p of pos) { const r = X.trial(ctx, { x: p.x, y: p.y, dist: d, mJy: 1e-9 }); if (r.foundShift) hits++; }
  assert.strictEqual(hits, 0);
});
t('motion-following stack: the noise is measured on the whole field and is close to the noise of a 4-image median of differences', () => {
  const nz = X.shiftNoise(ctx, 0, 300);
  // one image 0.1, a difference of two 0.1*sqrt(2) = 0.141, the median of 4 differences about 1.6x better: ~0.09 (whole-pixel shifts, no smoothing)
  assert.ok(nz && nz.sigma > 0.07 && nz.sigma < 0.13, JSON.stringify(nz));
});
t('the noise-based limit agrees with the measured recovery: 2 mag brighter is found (except on top of much brighter stars), 1.5 mag fainter never', () => {
  const lim = X.expectedLimit(ctx), pos = X.trialPositions(epochs[0].stack.flat, n, 16, 15, 3);
  const peak = ab => X.mJyToPixelSum(X.abToMJy(ab), 6.15) * ctx.psf.peakFrac;
  // the Analyst ignores a change within 5 px of a source at least 5x brighter (star residuals): a planet there is hidden
  const open = ab => pos.filter(p => !stars.some(s => Math.hypot(s[0] - p.x, s[1] - p.y) < 5 && s[2] > 5 * peak(ab)));
  const rate = (ab, list) => list.filter(p => X.trial(ctx, { x: p.x, y: p.y, dist: 600, mJy: X.abToMJy(ab) }).found).length / list.length;
  const hi = rate(lim.ab - 2, open(lim.ab - 2)), lo = rate(lim.ab + 1.5, pos);
  assert.ok(open(lim.ab - 2).length >= 8 && hi === 1 && lo <= 0.2, JSON.stringify({ lim: lim.ab, open: open(lim.ab - 2).length, hi, lo }));
});
t('motion-following scan of the whole field without a fake planet: no unexplained peaks on static stars + noise', () => {
  const sc = X.shiftScan(ctx, [30, 300, 1000]);
  assert.ok(sc.every(r => r.lone7[0] === 0 && r.lone7[1] === 0 && r.pairs5 === 0), JSON.stringify(sc));
});
console.log(`\n${pass} passed`);
