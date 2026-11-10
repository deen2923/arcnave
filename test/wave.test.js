'use strict';
// Tests for lib/wave.js using a synthetic file shaped exactly like a real SPHEREx cutout header
// (WCS-WAVE: X 13J, Y 20J, VALUES 520E (2,13,20); CRPIX1W=-1611, CRPIX2W=-920, CRVAL=1, CDELT=1).
const assert = require('assert');
const F = require('../lib/fits');
const W = require('../lib/wave');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('ok  ' + name); }, e => { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; });

const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
const header = cards => { const s = cards.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80); return Buffer.from(s.padEnd(Math.ceil(s.length / 2880) * 2880), 'ascii'); };
const pad = b => Buffer.concat([b, Buffer.alloc((2880 - b.length % 2880) % 2880)]);

// wavelength rises with detector x and a little with y: lam = 2.40 + 0.0007*(X-1) + 0.0002*(Y-1)
const LAM = (X, Y) => 2.40 + 0.0007 * (X - 1) + 0.0002 * (Y - 1);
function makeFile({ nx = 40, ny = 30, corruptOrder = false } = {}) {
  const xs = Array.from({ length: 13 }, (_, i) => 1 + Math.round(i * 2039 / 12));
  const ys = Array.from({ length: 20 }, (_, j) => 1 + Math.round(j * 2039 / 19));
  const row = Buffer.alloc(2212);
  xs.forEach((v, i) => row.writeInt32BE(v, i * 4));
  ys.forEach((v, j) => row.writeInt32BE(v, 52 + j * 4));
  for (let j = 0; j < 20; j++) for (let i = 0; i < 13; i++) {
    const base = 132 + 4 * (0 + 2 * (i + 13 * j));
    row.writeFloatBE(LAM(xs[i], ys[j]), base);          // m = 0 wavelength
    row.writeFloatBE(0.02 + 0.00001 * xs[i], base + 4); // m = 1 bandwidth
  }
  const prim = header([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]);
  const img = Buffer.concat([header([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', nx], ['NAXIS2', ny], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', 'IMAGE'],
    ['CTYPE1', 'RA---TAN'], ['CTYPE2', 'DEC--TAN'], ['CRPIX1', 20.5], ['CRPIX2', 15.5], ['CRVAL1', 190], ['CRVAL2', -4], ['CD1_1', -6.15 / 3600], ['CD1_2', 0], ['CD2_1', 0], ['CD2_2', 6.15 / 3600],
    ['CRPIX1W', -1611.0], ['CRPIX2W', -920.0], ['CDELT1W', 1], ['CDELT2W', 1], ['CRVAL1W', 1], ['CRVAL2W', 1], ['PV1_3W', 1], ['PV2_3W', 2]]), pad(Buffer.alloc(nx * ny * 4))]);
  const tab = Buffer.concat([header([['XTENSION', 'BINTABLE'], ['BITPIX', 8], ['NAXIS', 2], ['NAXIS1', 2212], ['NAXIS2', 1], ['PCOUNT', 0], ['GCOUNT', 1], ['TFIELDS', 3], ['EXTNAME', 'WCS-WAVE'],
    ['TTYPE1', 'X'], ['TFORM1', '13J'], ['TDIM1', '(13)'], ['TTYPE2', 'Y'], ['TFORM2', '20J'], ['TDIM2', '(20)'], ['TTYPE3', 'VALUES'], ['TFORM3', '520E'], ['TDIM3', corruptOrder ? '(2,13,19)' : '(2,13,20)']]), pad(row)]);
  const b = Buffer.concat([prim, img, tab]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

(async () => {
  await t('reads the WCS-WAVE table and bilinear lookup matches the known linear model', () => {
    const ab = makeFile(), hdus = F.parseFITS(ab), table = W.readWaveTable(ab, hdus), hi = F.findHDU(hdus, 'IMAGE');
    assert.strictEqual(table.nx, 13); assert.strictEqual(table.ny, 20); assert.strictEqual(table.M, 2);
    // cutout pixel (10,5): psi = 1 + (p - CRPIX) = p + 1612 and p + 921, in raw detector coordinates
    const r = W.waveAtPixel(table, hi.header, 10, 5);
    assert.ok(Math.abs(r.lam - LAM(10 + 1612, 5 + 921)) < 2e-4, `${r.lam} vs ${LAM(1622, 926)}`);
    assert.ok(!r.outside && r.bw > 0.02 && r.bw < 0.05);
    // moving 20 px in x must raise the wavelength by 20 * 0.0007 um
    const r2 = W.waveAtPixel(table, hi.header, 30, 5);
    assert.ok(Math.abs((r2.lam - r.lam) - 20 * 0.0007) < 1e-4, String(r2.lam - r.lam));
  });

  await t('waveAtSky: field centre lands on the table, off-image positions return null', () => {
    const ab = makeFile(), r = W.waveAtSky(F, ab, 190, -4);
    assert.ok(r && Math.abs(r.px - 20.5) < 1e-6 && Math.abs(r.lam - LAM(20.5 + 1612, 15.5 + 921)) < 2e-4);
    assert.strictEqual(W.waveAtSky(F, ab, 191, -4), null);
  });

  await t('clamps outside the control grid and says so; rejects malformed tables', () => {
    const ab = makeFile(), hdus = F.parseFITS(ab), table = W.readWaveTable(ab, hdus), hi = F.findHDU(hdus, 'IMAGE');
    assert.ok(W.waveAtPixel(table, hi.header, 5000, 5).outside);
    assert.throws(() => W.readWaveTable(makeFile({ corruptOrder: true }), F.parseFITS(makeFile({ corruptOrder: true }))), /does not match/);
    const noTab = makeFile().slice(0, 2880 * 2 + 2880 * 2); // primary + image header only: file ends early
    assert.strictEqual(W.readWaveTable(noTab, [{ header: { EXTNAME: 'IMAGE' }, dataStart: 0, dataLen: 0 }]), null);
  });

  await t('matchPairs: same detector, nearest wavelength first, one-to-one, tolerance respected', () => {
    const a = [{ id: 'a1', det: 'D4', lam: 2.50 }, { id: 'a2', det: 'D4', lam: 3.00 }, { id: 'a3', det: 'D4', lam: 3.70 }, { id: 'a4', det: 'D1', lam: 0.9 }];
    const b = [{ id: 'b1', det: 'D4', lam: 2.52 }, { id: 'b2', det: 'D4', lam: 3.01 }, { id: 'b3', det: 'D4', lam: 3.40 }, { id: 'b4', det: 'D1', lam: 0.91 }];
    const p = W.matchPairs(a, b, 0.05);
    assert.deepStrictEqual(p.map(x => x.a.id + '-' + x.b.id).sort(), ['a1-b1', 'a2-b2', 'a4-b4']); // a3 has no partner within 0.05 um
    assert.ok(p[0].dlam <= p[1].dlam && p[1].dlam <= p[2].dlam);
    assert.strictEqual(W.matchPairs(a, b, 0.001).length, 0);
    // one-to-one: two A images compete for one B image, the nearer wins
    const q = W.matchPairs([{ id: 'x', det: 'D2', lam: 1.30 }, { id: 'y', det: 'D2', lam: 1.31 }], [{ id: 'z', det: 'D2', lam: 1.309 }], 0.05);
    assert.strictEqual(q.length, 1); assert.strictEqual(q[0].a.id, 'y');
  });

  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
