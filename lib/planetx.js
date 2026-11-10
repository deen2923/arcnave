/* ARCNAVE: "Hide Planet X" (v0.10). An injection-recovery test on real SPHEREx images.
   A FAKE distant planet is added to the aligned images of a field, the epoch stacks are rebuilt, and the same detector
   the Analyst uses (SkyFits.findTransients + the shape check) looks for it. v0.30: also a motion-following stack (images
   shifted back along the planet's path before stacking), for planets that move too far within one pass. Nothing here searches for a real Planet X.
   Works in the browser (window.SkyPlanetX) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyPlanetX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, ARCSEC = 180 / Math.PI * 3600, AB_ZERO_MJY = 3631e3;

  /* ---------- where Earth is ---------- */
  // Geocentric Sun, equatorial J2000-ish, in AU. Low-precision formula of the Astronomical Almanac (good to about 0.01 deg in
  // longitude 1950-2050). mjd = Modified Julian Date (UTC is fine at this precision).
  function sunVector(mjd) {
    const n = mjd - 51544.5;                                  // days from J2000.0
    const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g), eps = (23.439 - 0.0000004 * n) * D2R;
    return [R * Math.cos(lam), R * Math.cos(eps) * Math.sin(lam), R * Math.sin(eps) * Math.sin(lam)];
  }
  const earthVector = mjd => sunVector(mjd).map(v => -v);    // heliocentric Earth (SPHEREx is in low Earth orbit: 0.00005 AU)
  const unit = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
  function toRaDec(v) {
    const r = Math.hypot(v[0], v[1], v[2]);
    let ra = Math.atan2(v[1], v[0]) / D2R; if (ra < 0) ra += 360;
    return { ra, dec: Math.asin(v[2] / r) / D2R, dist: r };
  }
  function sepArcsec(a, b) {
    const u = unit(a.ra, a.dec), w = unit(b.ra, b.dec);
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    return Math.atan2(Math.hypot(c[0], c[1], c[2]), u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) * ARCSEC;
  }

  /** Sky positions of a body that stays put relative to the Sun, seen from Earth. It is at (ra0, dec0) and dist AU from
      Earth at time mjd0. Its own orbital motion is left out: at 500 AU a circular orbit moves about 2 arcmin a year,
      against a parallax jump of up to about 14 arcmin between two passes six months apart. */
  function track(ra0, dec0, dist, mjd0, mjds) {
    const E0 = earthVector(mjd0), u = unit(ra0, dec0), P = [0, 1, 2].map(k => E0[k] + dist * u[k]);
    return mjds.map(t => { const E = earthVector(t); return toRaDec([P[0] - E[0], P[1] - E[1], P[2] - E[2]]); });
  }
  /** Orbital motion of a circular orbit at r AU (arcsec per year, seen from the Sun), for the caveat text. */
  const orbitArcsecPerYear = r => 360 * 3600 / Math.pow(r, 1.5);

  /* ---------- brightness ---------- */
  const abToMJy = m => AB_ZERO_MJY * Math.pow(10, -0.4 * m);
  const mJyToAb = f => -2.5 * Math.log10(f / AB_ZERO_MJY);
  /** Total of all pixels (MJy/sr) that a point source of f mJy adds to an image with square pixels of pixArcsec. */
  function mJyToPixelSum(f, pixArcsec) { const om = Math.pow(pixArcsec / ARCSEC, 2); return f * 1e-3 / (om * 1e6); }
  const pixelSumToMJy = (s, pixArcsec) => s * Math.pow(pixArcsec / ARCSEC, 2) * 1e6 * 1e3;

  /* ---------- the telescope's blur, measured on the field's own stars ---------- */
  /** Empirical PSF: median of the normalised (2R+1)^2 boxes around bright, isolated stars (peak > minSnr sigma, no other
      peak above 5% of it within isoPx, no NaN in the box), centred on the brightest pixel. Sum = 1 inside the box. */
  function buildPSF(flat, n, st, opts) {
    opts = opts || {};
    const R = opts.R || 4, minSnr = opts.minSnr || 30, iso = opts.isoPx || 7, maxStars = opts.maxStars || 60, side = 2 * R + 1;
    const lim = st.med + minSnr * st.sigma, peaks = [];
    for (let y = R + 1; y < n - R - 1; y++) for (let x = R + 1; x < n - R - 1; x++) {
      const c = flat[y * n + x]; if (!(c > lim)) continue;
      let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !(flat[(y + j) * n + x + i] < c)) { max = false; break; }
      if (max) peaks.push({ x, y, v: c - st.med });
    }
    // isolation against every local maximum above 5 sigma, not only the bright ones
    const lim5 = st.med + 5 * st.sigma, faint = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const c = flat[y * n + x]; if (!(c > lim5)) continue;
      let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !(flat[(y + j) * n + x + i] < c)) { max = false; break; }
      if (max) faint.push({ x, y, v: c - st.med });
    }
    const good = peaks.filter(p => !faint.some(q => (q.x !== p.x || q.y !== p.y) && Math.hypot(q.x - p.x, q.y - p.y) < iso && q.v > 0.05 * p.v));
    good.sort((p, q) => q.v - p.v);
    const stamps = [];
    for (const p of good) {
      if (stamps.length >= maxStars) break;
      const s = new Float64Array(side * side); let sum = 0, bad = false;
      for (let j = -R; j <= R && !bad; j++) for (let i = -R; i <= R; i++) { const v = flat[(p.y + j) * n + p.x + i] - st.med; if (v !== v) { bad = true; break; } s[(j + R) * side + i + R] = v; sum += v; }
      if (bad || !(sum > 0)) continue;
      for (let k = 0; k < s.length; k++) s[k] /= sum;
      stamps.push(s);
    }
    if (stamps.length < 5) return null;
    const psf = new Float64Array(side * side), col = new Float64Array(stamps.length);
    for (let k = 0; k < psf.length; k++) { for (let m = 0; m < stamps.length; m++) col[m] = stamps[m][k]; const a = Array.from(col).sort((p, q) => p - q); psf[k] = a[a.length >> 1]; }
    let sum = 0; for (let k = 0; k < psf.length; k++) { if (psf[k] < 0) psf[k] = 0; sum += psf[k]; }
    for (let k = 0; k < psf.length; k++) psf[k] /= sum;
    // width: second moment -> Gaussian-equivalent FWHM (pixels), and the share of light in the brightest pixel
    let mxx = 0, myy = 0; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const w = psf[(j + R) * side + i + R]; mxx += w * i * i; myy += w * j * j; }
    return { psf, R, side, nStars: stamps.length, peakFrac: psf[R * side + R], fwhmPx: 2.3548 * Math.sqrt((mxx + myy) / 2) };
  }

  /** Bilinear sample of the PSF box at offset (u, v) pixels from its centre (0 outside). */
  function psfAt(P, u, v) {
    if (P.at) return Math.max(0, P.at(u, v));   // SkyFits ePSF (continuous, oversampled)
    const fx = u + P.R, fy = v + P.R, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, s = P.side;
    const g = (x, y) => x < 0 || y < 0 || x >= s || y >= s ? 0 : P.psf[y * s + x];
    return g(x0, y0) * (1 - tx) * (1 - ty) + g(x0 + 1, y0) * tx * (1 - ty) + g(x0, y0 + 1) * (1 - tx) * ty + g(x0 + 1, y0 + 1) * tx * ty;
  }
  /** Pixels a point source of total `sum` (MJy/sr summed over pixels) at (x, y) adds: [[index, value], ...]. */
  function sourcePixels(P, n, x, y, sum) {
    const out = [], X0 = Math.round(x), Y0 = Math.round(y), r = P.R + 1; let tot = 0;
    for (let Y = Y0 - r; Y <= Y0 + r; Y++) for (let X = X0 - r; X <= X0 + r; X++) {
      const w = psfAt(P, X - x, Y - y); tot += w;
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      if (w > 0) out.push([Y * n + X, w]);
    }
    for (const o of out) o[1] *= sum / (tot || 1);   // exactly `sum` in total at any sub-pixel position (minus what falls off the grid)
    return out;
  }

  /* ---------- one trial ---------- */
  /** Median with the rule of SkyFits.medianStack (NaN skipped, needs minValid values, even count = mean of the middle two). */
  function medianOf(vals, minValid) {
    const a = vals.filter(v => v === v); if (a.length < minValid) return NaN;
    a.sort((p, q) => p - q); const m = a.length;
    return m & 1 ? a[m >> 1] : 0.5 * (a[(m >> 1) - 1] + a[m >> 1]);
  }

  /** Context for many trials on one field. epochs: [{frames: [{flat, touched, mjd}], stack: {flat, touched, st}}] for the
      two compared epochs (a = first, b = last). One frame per epoch is fine (then the "stack" is that frame).
      grid {ra0, dec0, s (deg/px), n}. F = SkyFits. The base comparison (no fake planet) is run once here. */
  function makeContext(F, epochs, grid, opts) {
    opts = opts || {};
    const n = grid.n, pixArcsec = grid.s * 3600;
    const tOpts = { maxSep: opts.maxSep ?? 0.25, matchRadius: opts.matchRadius || 2.5 };
    const A = epochs[0].stack, B = epochs[1].stack;
    const base = F.findTransients(A.flat, B.flat, n, grid, { ...tOpts, touchedA: A.touched, touchedB: B.touched });
    // One PSF per compared epoch, measured on that epoch's stack with SkyFits.empiricalPSF (the ePSF checked against the
    // official SPHEREx PSF in test/psf.official.test.js); the simple median-of-boxes buildPSF is only a fallback.
    const fromFits = S => { if (!F.empiricalPSF) return null; const P = F.empiricalPSF(S.flat, n, S.st || F.robustStats(S.flat));
      return P && { psf: P.psf, R: P.half, side: P.size, nStars: P.nStars, peakFrac: P.peakFrac, fwhmPx: P.fwhm, at: P.at, method: 'epsf' }; };
    const psfs = opts.psf ? [opts.psf, opts.psf] : [A, B].map(S => fromFits(S) || buildPSF(S.flat, n, S.st));
    const psf = psfs[0];
    const shapeA = F.starShapeMedian(A.flat, n, A.st), shapeB = F.starShapeMedian(B.flat, n, B.st);
    // motion-following stack (v0.30): every image of one pass is compared with the image of the other pass taken in the same
    // colour (nearest wavelength; the passes are colour-matched by the Archivist), so stars cancel image by image
    const partner = [0, 1].map(e => epochs[e].frames.map(f => { const o = epochs[1 - e].frames; let best = 0;
      if (f.lam != null) o.forEach((g, j) => { if (g.lam != null && Math.abs(g.lam - f.lam) < Math.abs(o[best].lam - f.lam)) best = j; });
      else best = Math.min(o.length - 1, epochs[e].frames.indexOf(f) % o.length);
      return best; }));
    return { F, epochs, grid, n, pixArcsec, tOpts, base, psf, psfs, shape: [shapeA, shapeB], sharpFrac: opts.sharpFrac || 0.5,
      shift: opts.shift !== false, partner, shiftCache: new Map(), stars: [A, B].map(S => peaksOf(S.flat, n, S.st || F.robustStats(S.flat))) };
  }

  /* ---------- motion-following stack (v0.30) ---------- */
  // A planet near 300 AU moves tens of pixels during one pass (its images are spread over days to weeks), so the plain
  // median of the pass removes it like a cosmic ray. Here every image of pass e minus its same-colour partner image of the
  // other pass (stars cancel) is shifted back along the path a body at that distance would follow, and the shifted
  // differences are median-stacked: the planet adds up at one spot, everything else does not. Shifts are whole pixels: a
  // sub-pixel (interpolated) shift would smooth the noise by an amount that depends on the fraction, so the noise measured
  // once for the field would not fit every spot; half a pixel of misalignment costs little against a 2-pixel-wide star.
  function sampleAt(flat, extra, n, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 >= n - 1 || y0 >= n - 1) return NaN;
    const tx = x - x0, ty = y - y0, i = y0 * n + x0, g = k => { const v = flat[k]; return v === v ? v + (extra ? extra.get(k) || 0 : 0) : NaN; };
    return g(i) * (1 - tx) * (1 - ty) + g(i + 1) * tx * (1 - ty) + g(i + n) * (1 - tx) * ty + g(i + n + 1) * tx * ty;
  }
  /** Sources of a stack: local maxima above 5 sigma, with their peak above the median (for the "explained by a star" rule). */
  function peaksOf(flat, n, st) {
    const out = []; if (!st) return out;
    const lim = st.med + 5 * st.sigma;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const c = flat[y * n + x]; if (!(c > lim)) continue;
      let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && flat[(y + j) * n + x + i] > c) { max = false; break; }
      if (max) out.push({ x, y, f: c - st.med });
    }
    return out;
  }
  /** Shifted-difference median of pass e at grid pixels (X, Y) for (X, Y) in `pix`; offs[j] = where the body is in image j
      minus where it is at the reference time. extras[e][j] = pixels a fake planet adds to image j (or null). */
  function shiftValues(ctx, e, offs, pix, extras) {
    const { n, epochs, partner } = ctx, fr = epochs[e].frames, ot = epochs[1 - e].frames, k = fr.length, minValid = Math.min(k, 3);
    const out = new Float32Array(pix.length), buf = new Float64Array(k);
    for (let p = 0; p < pix.length; p++) {
      const X = pix[p][0], Y = pix[p][1]; let m = 0;
      for (let j = 0; j < k; j++) {
        const x = X + offs[j][0], y = Y + offs[j][1], q = partner[e][j];
        const v = sampleAt(fr[j].flat, extras && extras[e][j], n, x, y) - sampleAt(ot[q].flat, extras && extras[1 - e][q], n, x, y);
        if (v === v) buf[m++] = v;
      }
      if (m < minValid) { out[p] = NaN; continue; }
      const a = Array.prototype.slice.call(buf, 0, m).sort((u, w) => u - w);
      out[p] = m & 1 ? a[m >> 1] : 0.5 * (a[(m >> 1) - 1] + a[m >> 1]);
    }
    return out;
  }
  /** Image offsets along the path of a body at `dist` AU, seen from the field centre, relative to image `ref` of pass e. */
  function pathOffsets(ctx, e, dist, at) {
    const { F, grid, epochs, n } = ctx, c = at || F.gridToSky((n - 1) / 2, (n - 1) / 2, grid), t0 = epochs[0].frames[0].mjd;
    const pos = track(c[0], c[1], dist, t0, epochs[e].frames.map(f => f.mjd)).map(p => F.skyToGrid(p.ra, p.dec, grid) || [NaN, NaN]);
    const r = pos[Math.floor(pos.length / 2)];
    return pos.map(p => [Math.round(p[0] - r[0]), Math.round(p[1] - r[1])]);
  }
  /** Noise of the motion-following stack of pass e for `dist` AU, measured once on the whole field (no fake planet). */
  function shiftNoise(ctx, e, dist) {
    const key = e + '|' + dist; if (ctx.shiftCache.has(key)) return ctx.shiftCache.get(key);
    const n = ctx.n, offs = pathOffsets(ctx, e, dist), pix = [];
    for (let y = 2; y < n - 2; y += 2) for (let x = 2; x < n - 2; x += 2) pix.push([x, y]);   // every 2nd pixel is plenty for the noise
    const st = ctx.F.robustStats(shiftValues(ctx, e, offs, pix, null)), r = st ? { med: st.med, sigma: st.sigma } : null;
    ctx.shiftCache.set(key, r); return r;
  }
  /** Signal of a fake planet in the motion-following stack of pass e: the highest local peak within matchRadius of where it
      is at the reference image, in sigma, counted only where the same stack without the planet is quiet (under 5 sigma). */
  function shiftHit(ctx, e, dist, at, offs, extras) {
    const n = ctx.n, R = 4, cx = Math.round(at.x), cy = Math.round(at.y), side = 2 * R + 1, r = ctx.tOpts.matchRadius;
    if (!(cx >= R + 1 && cy >= R + 1 && cx <= n - R - 2 && cy <= n - R - 2) || ctx.epochs[e].frames.length < 2) return null;
    const noise = shiftNoise(ctx, e, dist); if (!noise || !(noise.sigma > 0)) return null;
    const pix = []; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) pix.push([cx + i, cy + j]);
    const v = shiftValues(ctx, e, offs, pix, extras), b = shiftValues(ctx, e, offs, pix, null);
    let best = null;
    for (let j = -R + 1; j <= R - 1; j++) for (let i = -R + 1; i <= R - 1; i++) {
      const k = (j + R) * side + i + R, c = v[k]; if (!(c === c) || Math.hypot(cx + i - at.x, cy + j - at.y) > r) continue;
      let max = true; for (let dj = -1; dj <= 1 && max; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && v[k + dj * side + di] > c) { max = false; break; }
      if (!max) continue;
      const snr = (c - noise.med) / noise.sigma, base = (b[k] - noise.med) / noise.sigma;
      if (base >= 5) continue;   // something real is there already (a star leftover): not the fake planet
      // the same rule as the plain detector (findTransients): a peak next to a star at least as bright (or 5x brighter within
      // 5 px) is a star leftover, whatever made it. On the real field 189.957 -4.182 every 7-sigma peak of the motion-following
      // stack without a fake planet (4 to 17 per pass and distance) was such a leftover, so this rule is what keeps the method
      // from crying wolf on real data, and the test must play by it too.
      const amp = c - noise.med, X = cx + i, Y = cy + j;
      if (ctx.stars.some(L => L.some(q => { const d = Math.hypot(q.x - X, q.y - Y); return (d <= r && q.f >= amp) || (d <= 2 * r && q.f >= 5 * amp); }))) continue;
      if (!best || snr > best.snr) best = { snr, x: cx + i, y: cy + j };
    }
    return best;
  }

  /** The motion-following stack run over the whole real field with NO fake planet, for every distance: how many peaks it
      would report there (7 sigma in one pass, or 5 sigma in both passes at positions one parallax jump apart) that no star
      explains. No real planet is expected, so these are false alarms (or real moving things; either way the count is an
      upper limit on the false alarms of a real search with this method). */
  function shiftScan(ctx, dists) {
    const { F, n, grid, epochs } = ctx, r = ctx.tOpts.matchRadius, M = 6, W = n - 2 * M, pix = [];
    for (let y = M; y < n - M; y++) for (let x = M; x < n - M; x++) pix.push([x, y]);
    const explained = (X, Y, amp) => ctx.stars.some(L => L.some(q => { const d = Math.hypot(q.x - X, q.y - Y); return (d <= r && q.f >= amp) || (d <= 2 * r && q.f >= 5 * amp); }));
    const c = F.gridToSky((n - 1) / 2, (n - 1) / 2, grid), t0 = epochs[0].frames[0].mjd;
    return dists.map(dist => {
      const z = [0, 1].map(e => { const nz = shiftNoise(ctx, e, dist), v = shiftValues(ctx, e, pathOffsets(ctx, e, dist), pix, null), out = new Float32Array(v.length);
        for (let i = 0; i < v.length; i++) out[i] = nz && nz.sigma > 0 && v[i] === v[i] ? (v[i] - nz.med) / nz.sigma : NaN;
        return { z: out, sigma: nz ? nz.sigma : NaN }; });
      // where the reference image of pass b sees a body that the reference image of pass a sees at the field centre
      const mid = e => { const fr = epochs[e].frames, p = track(c[0], c[1], dist, t0, [fr[Math.floor(fr.length / 2)].mjd])[0], g = F.skyToGrid(p.ra, p.dec, grid); return g || [NaN, NaN]; };
      const ma = mid(0), mb = mid(1), jx = Math.round(mb[0] - ma[0]), jy = Math.round(mb[1] - ma[1]);
      const peaks = e => { const Z = z[e].z, L = [];
        for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) { const q = Z[y * W + x]; if (!(q >= 5)) continue;
          let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && Z[(y + j) * W + x + i] > q) { max = false; break; }
          if (max && !explained(x + M, y + M, q * z[e].sigma)) L.push({ x: x + M, y: y + M, s: q }); }
        return L; };
      const pa = peaks(0), pb = peaks(1);
      const pairs = pa.filter(p => pb.some(q => Math.hypot(q.x - (p.x + jx), q.y - (p.y + jy)) <= r)).length;
      return { dist, lone7: [pa.filter(p => p.s >= 7).length, pb.filter(p => p.s >= 7).length], pairs5: pairs, jumpPx: Math.hypot(jx, jy) };
    });
  }

  /** Hide one fake planet: (x, y) grid position at the time of the first image of epoch a, geocentric distance (AU) and
      brightness (mJy, flat across the band). Returns what the detector made of it. */
  function trial(ctx, planet) {
    const { F, epochs, grid, n, psf } = ctx;
    if (!psf || (ctx.psfs && !ctx.psfs[1])) return { error: 'no PSF: fewer than 5 bright isolated stars' };
    const sky0 = F.gridToSky(planet.x, planet.y, grid), t0 = epochs[0].frames[0].mjd;
    const sum = mJyToPixelSum(planet.mJy, ctx.pixArcsec);
    const out = { mJy: planet.mJy, ab: mJyToAb(planet.mJy), dist: planet.dist, epochs: [] };
    const stacks = [], extras = [], offsets = [];
    epochs.forEach((ep, e) => {
      const mj = ep.frames.map(f => f.mjd), pos = track(sky0[0], sky0[1], planet.dist, t0, mj).map(p => { const g = F.skyToGrid(p.ra, p.dec, grid); return { ra: p.ra, dec: p.dec, x: g ? g[0] : NaN, y: g ? g[1] : NaN }; });
      const adds = pos.map(p => p.x >= 0 && p.y >= 0 && p.x <= n - 1 && p.y <= n - 1 ? sourcePixels((ctx.psfs && ctx.psfs[e]) || psf, n, p.x, p.y, sum) : []);
      const inside = adds.filter(a => a.length).length;
      // rebuild the stack only where the fake planet touched it
      const flat = Float32Array.from(ep.stack.flat), k = ep.frames.length, minValid = Math.min(k, 3);
      const touchedPx = new Set(); adds.forEach(a => a.forEach(([i]) => touchedPx.add(i)));
      const extra = adds.map(a => new Map(a));
      extras.push(extra);
      for (const i of touchedPx) {
        if (k === 1) { const v = ep.frames[0].flat[i]; flat[i] = v === v ? v + (extra[0].get(i) || 0) : NaN; continue; }
        flat[i] = medianOf(ep.frames.map((f, j) => { const v = f.flat[i]; return v === v ? v + (extra[j].get(i) || 0) : NaN; }), minValid);
      }
      const mid = pos[Math.floor(pos.length / 2)];
      offsets.push(pos.map(p => [Math.round(p.x - mid.x), Math.round(p.y - mid.y)]));
      out.epochs.push({ frames: k, inside, at: mid, track: pos, spanDays: mj[mj.length - 1] - mj[0],
        moveDuringEpochPx: Math.hypot(pos[pos.length - 1].x - pos[0].x, pos[pos.length - 1].y - pos[0].y) });
      stacks.push({ flat, touched: ep.stack.touched });
    });
    // noise levels of the two stacks and their difference are taken from the base comparison: a fake planet changes a few
    // pixels out of tens of thousands, so re-measuring them for each of >1000 trials only costs time
    const t = F.findTransients(stacks[0].flat, stacks[1].flat, n, grid, { ...ctx.tOpts, touchedA: stacks[0].touched, touchedB: stacks[1].touched, stats: ctx.base.stats });
    const fresh = c => !ctx.base.cands.some(q => q.kind === c.kind && Math.hypot(q.x - c.x, q.y - c.y) <= 1.5);
    const r = ctx.tOpts.matchRadius;
    // epoch a: where it was ("gone"), epoch b: where it is ("new"); a pair counts for both
    const hit = (e, kinds, key) => {
      const p = out.epochs[e].at; if (!(p.x >= 0)) return null;
      const c = t.cands.find(q => kinds.includes(q.kind) && fresh(q) && Math.hypot((key(q).x) - p.x, key(q).y - p.y) <= r);
      if (!c) return null;
      const P = key(c), stk = stacks[e].flat, sh = F.peakShape(stk, n, P.x, P.y), ref = ctx.shape[e];
      const sharp = sh != null && ref ? sh < ctx.sharpFrac * ref.median : false;
      return { snr: c.snr, kind: c.kind, x: P.x, y: P.y, shape: sh, sharp };
    };
    const fa = hit(0, ['gone', 'pair'], q => q.from || q), fb = hit(1, ['new', 'pair'], q => q.to || q);
    out.foundA = !!(fa && !fa.sharp); out.foundB = !!(fb && !fb.sharp); out.hitA = fa; out.hitB = fb;
    out.foundPlain = out.foundA || out.foundB;
    // motion-following stack in both passes: found when it stands out in both (5 sigma each, like a pair of the plain
    // detector) or in one alone at 7 sigma (like a lone source of the plain detector)
    if (ctx.shift) {
      // The path follows Earth's motion only (parallax); the planet's own orbital motion is unknown and left out. Over one
      // pass that costs alignment: at 300 AU about 250"/yr, so 4" in 6 days but 22" (3.5 px) in 32 days. A real search
      // could not line such a planet up without also guessing its orbit, so a pass counts only when the orbital motion
      // during it stays under one pixel.
      const orbitPx = e => orbitArcsecPerYear(planet.dist) * out.epochs[e].spanDays / 365.25 / ctx.pixArcsec;
      out.orbitPx = [orbitPx(0), orbitPx(1)];
      const s = [0, 1].map(e => orbitPx(e) <= 1 && offsets[e].every(o => o[0] === o[0]) ? shiftHit(ctx, e, planet.dist, out.epochs[e].at, offsets[e], extras) : null);
      const sa = s[0] ? s[0].snr : null, sb = s[1] ? s[1].snr : null;
      out.shift = { snrA: sa, snrB: sb };
      out.foundShift = (sa >= 5 && sb >= 5) || sa >= 7 || sb >= 7;
    } else out.foundShift = false;
    out.found = out.foundPlain || out.foundShift;
    out.shiftArcsec = sepArcsec(out.epochs[0].at, out.epochs[1].at);
    out.dtDays = epochs[1].frames[0].mjd - t0;
    out.stacks = stacks;
    return out;
  }

  /** Noise-based expectation: the faintest source whose brightest pixel stands 7 sigma above the difference image
      (the Analyst's limit for a source with no partner). Returns mJy and AB. */
  function expectedLimit(ctx, nsig) {
    nsig = nsig || 7;
    const A = ctx.epochs[0].stack.flat, B = ctx.epochs[1].stack.flat, d = new Float32Array(A.length);
    for (let i = 0; i < d.length; i++) d[i] = A[i] === A[i] && B[i] === B[i] ? B[i] - A[i] : NaN;
    const sd = ctx.F.robustStats(d).sigma, sum = nsig * sd / ctx.psf.peakFrac, f = pixelSumToMJy(sum, ctx.pixArcsec);
    return { mJy: f, ab: mJyToAb(f), sigmaDiff: sd, nsig };
  }

  /** Detectability map: for every distance x brightness, hide the planet at `positions` and count recoveries. Async with
      a progress callback so a browser stays responsive. */
  async function map(ctx, opts) {
    const dists = opts.dists, mags = opts.mags, pos = opts.positions, cells = [];
    let done = 0; const total = dists.length * mags.length * pos.length;
    for (const dist of dists) for (const ab of mags) {
      let found = 0, both = 0, plain = 0;
      for (const p of pos) { const r = trial(ctx, { x: p.x, y: p.y, dist, mJy: abToMJy(ab) }); if (r.found) found++; if (r.foundPlain) plain++; if (r.foundA && r.foundB) both++; done++; }
      cells.push({ dist, ab, mJy: abToMJy(ab), found, both, plain, of: pos.length });
      if (opts.progress) await opts.progress(done / total);
    }
    // per distance: faintest magnitude still recovered at least half the time
    const lim = k => dists.map(d => { const ok = cells.filter(c => c.dist === d && c[k] / c.of >= 0.5).map(c => c.ab); return { dist: d, ab50: ok.length ? Math.max(...ok) : null }; });
    // limits: with the motion-following stack (what the test now uses); limitsPlain: the plain stacks alone (before v0.30)
    return { cells, limits: lim('found'), limitsPlain: lim('plain'), dists, mags, positions: pos.length };
  }

  /** Spread-out trial spots: a seeded grid with jitter, at least `margin` px from the edge, never on NaN pixels. */
  function trialPositions(flat, n, count, margin, seed) {
    let s = seed || 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = [], m = margin || 20, k = Math.ceil(Math.sqrt(count)), cell = (n - 2 * m) / k;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      if (out.length >= count) break;
      for (let tries = 0; tries < 20; tries++) {
        const x = m + (i + rnd()) * cell, y = m + (j + rnd()) * cell, v = flat[Math.round(y) * n + Math.round(x)];
        if (v === v) { out.push({ x, y }); break; }
      }
    }
    return out;
  }

  return { sunVector, earthVector, track, sepArcsec, orbitArcsecPerYear, abToMJy, mJyToAb, mJyToPixelSum, pixelSumToMJy,
    buildPSF, psfAt, sourcePixels, makeContext, trial, expectedLimit, map, trialPositions, pathOffsets, shiftValues, shiftNoise, shiftScan };
});
