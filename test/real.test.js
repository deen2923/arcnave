'use strict';
// Real NASA SPHEREx data (IRSA QR2), not synthetic: two D4 cutouts of the same 0.5 deg field one year apart, saved by the
// app's debug bundle on 2026-10-15 (PSF and VARIANCE removed to keep them small). This is the field where v0.1 reported 50
// fake "moved" sources. These tests pin down why, and that the pipeline the app runs now gets it right.
// Run: node test/real.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const F = require('../lib/fits'), W = require('../lib/wave');
const FX = path.join(__dirname, 'fixtures'), meta = JSON.parse(fs.readFileSync(path.join(FX, 'real_pair.json'), 'utf8'));
const load = f => { const b = fs.readFileSync(path.join(FX, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const bufA = load(meta.files.A), bufB = load(meta.files.B);
const PX = 6.15 / 3600, fld = meta.field, n = Math.round(fld.size / PX), grid = { ra0: fld.ra, dec0: fld.dec, s: PX, n };
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };

// The app's pipeline (public/app.js buildFrame + alignFrame + analyse), minus drawing.
function run(maskFlags) {
  const prep = buf => {
    if (maskFlags) return F.prepareCutout(buf, grid);
    // v0.2 behaviour: FLAGS ignored
    const hd = F.parseFITS(buf), hi = F.findHDU(hd, 'IMAGE'), img = F.readImage(buf, hi), z = F.readImage(buf, F.findHDU(hd, 'ZODI')).data;
    const flat = F.flatten(F.resample(img.data.map((v, k) => v - z[k]), img.nx, img.ny, F.makeWCS(hi.header), grid), n);
    return { flat, touched: null, st: F.robustStats(flat) };
  };
  const A = prep(bufA), B = prep(bufB);
  const sh = F.alignByStars(A.flat, B.flat, n);
  const Bf = sh.ok && Math.hypot(sh.dx, sh.dy) > 0.05 ? F.shiftImage(B.flat, n, sh.dx, sh.dy) : B.flat;
  const Bt = B.touched && sh.ok && Math.hypot(sh.dx, sh.dy) > 0.05 ? F.shiftImage(B.touched, n, sh.dx, sh.dy) : B.touched;
  const dtDays = 61193.6225 - 60826.5800, maxSep = 11 * dtDays / 365.25 / 6.15;   // app: STAR_PM_MAX = 11"/yr
  const r = F.findTransients(A.flat, Bf, n, grid, { maxSep, matchRadius: 2.5, touchedA: A.touched, touchedB: Bt });
  const gated = r.nearMiss >= 5 && r.nearMiss >= 0.05 * Math.max(1, r.matched);           // app: GATE
  return { A, B, sh, r, gated };
}

t('FLAGS bit names are read from HIERARCH cards (MP_OUTLIER, MP_SOURCE...)', () => {
  const hf = F.findHDU(F.parseFITS(bufB), 'FLAGS');
  assert.strictEqual(hf.header.MP_OUTLIER, 19); assert.strictEqual(hf.header.MP_SOURCE, 21); assert.strictEqual(hf.header.MP_HALO, 28);
  const m = F.badFlagMask(hf.header);
  assert.ok(m.named && (m.glitch & (1 << 19)) && !(m.glitch & (1 << 21)) && (m.area & (1 << 28)), JSON.stringify(m));
});

t('high flag bits survive (FLAGS read as exact integers)', () => {
  const hf = F.findHDU(F.parseFITS(bufB), 'FLAGS'), fl = F.readFlags(bufB, hf).data;
  assert.ok(fl.some(v => v >= 2 ** 22), 'expected some pixels with GHOST/BLOOM/HALO bits');
});

const before = run(false), after = run(true);

t('v0.2 behaviour reproduced: without the FLAGS mask the epochs look misaligned (data check trips)', () => {
  assert.ok(before.gated && before.r.nearMiss >= 20, JSON.stringify({ nearMiss: before.r.nearMiss, matched: before.r.matched }));
});

t('masking removes thousands of glitch pixels', () => {
  assert.ok(after.A.mask.glitch > 1000 && after.B.mask.glitch > 500, JSON.stringify([after.A.mask, after.B.mask]));
});

t('star-based alignment: dozens of stars agree to within a few hundredths of a pixel', () => {
  const s = after.sh;
  assert.ok(s.ok && s.nMatch >= 40 && Math.hypot(s.dx, s.dy) < 0.1 && s.spread < 0.3, JSON.stringify(s));
});

t('with the mask: data check passes and only a handful of unconfirmed changes remain (v0.1: 50)', () => {
  const r = after.r;
  console.log(`     matched ${r.matched}, near misses ${r.nearMiss}, not judged next to bad pixels ${r.flagRejected}, changes ${r.cands.length}`);
  assert.ok(!after.gated && r.nearMiss <= 2, JSON.stringify({ nearMiss: r.nearMiss, matched: r.matched }));
  assert.ok(r.cands.length <= 3, 'changes: ' + r.cands.length);
  assert.ok(r.matched >= 100);
  assert.ok(!r.cands.some(c => c.kind === 'pair'), 'one year apart: no physical "moved" pairs');
});

t('footprint polygon (hex WKB from IRSA TAP) decodes to the four detector corners', () => {
  const p = W.polyFromWKB(meta.polyHexA);
  assert.strictEqual(p.length, 4);
  p.forEach((v, i) => assert.ok(Math.abs(v[0] - meta.poly.A[i][0]) < 1e-5 && Math.abs(v[1] - meta.poly.A[i][1]) < 1e-5));
});

t('wavelength and detector position predicted from the footprint match the downloaded files', () => {
  for (const [k, buf] of [['A', bufA], ['B', bufB]]) {
    const pos = W.detPosFromPoly(meta.poly[k], fld.ra, fld.dec), hi = F.findHDU(F.parseFITS(buf), 'IMAGE');
    const real = W.detPosFromHeader(F, hi.header, fld.ra, fld.dec), lam = W.lamAtDetector(W.BUILTIN_TABLES.D4, pos.x, pos.y).lam;
    const lamReal = W.waveAtSky(F, buf, fld.ra, fld.dec).lam;
    console.log(`     ${k}: detector (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) vs file (${real.x.toFixed(0)}, ${real.y.toFixed(0)}); ${lam.toFixed(4)} vs ${lamReal.toFixed(4)} micron`);
    assert.ok(Math.hypot(pos.x - real.x, pos.y - real.y) < 15, 'detector position off');
    assert.ok(Math.abs(lam - lamReal) < 0.01, 'wavelength off');
  }
  // and the built-in D4 table is the one in the files
  const tb = W.readWaveTable(bufB, F.parseFITS(bufB));
  assert.ok(Array.from(tb.vals).every((v, i) => Math.abs(v - W.BUILTIN_TABLES.D4.vals[i]) < 1e-4));
});

t('coverage: image B only covers part of this field (the field sits on its detector edge)', () => {
  const half = fld.size / 2 / PX;
  const cA = W.coverage(W.detPosFromPoly(meta.poly.A, fld.ra, fld.dec), half), cB = W.coverage(W.detPosFromPoly(meta.poly.B, fld.ra, fld.dec), half);
  assert.ok(cA > 0.99 && cB < 0.6, JSON.stringify({ cA, cB }));
});

console.log(`\n${passed} passed`);
