// One-star reads for spectra (lib/spot.js): RICE_1 decoding against astropy, pixel-exact reads from a full file built on a
// real SPHEREx layout, the learned layout (3 requests per file after the first), and aperture photometry of a fake star.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const F = require('../lib/fits'), SP = require('../lib/spot'), Wv = require('../lib/wave');
// 1. RICE_1: 40 rows written by astropy (random 31-bit, SPHEREx-like flag values, constant rows, small signed values)
{
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'rice_rows.fits')), ref = fs.readFileSync(path.join(__dirname, 'fixtures', 'rice_rows.i32be'));
  const hd = F.parseFITS(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), h = hd[1].header, ds = hd[1].dataStart;
  const heap = ds + (h.THEAP || h.NAXIS1 * h.NAXIS2); let bad = 0;
  for (let j = 0; j < h.NAXIS2; j++) {
    const n = buf.readInt32BE(ds + j * 8), o = buf.readInt32BE(ds + j * 8 + 4);
    const row = SP.riceDecode(new Uint8Array(buf.subarray(heap + o, heap + o + n)), h.ZNAXIS1, h.ZVAL1, h.ZVAL2);
    for (let i = 0; i < h.ZNAXIS1; i++) if (row[i] !== ref.readInt32BE((j * h.ZNAXIS1 + i) * 4)) bad++;
  }
  assert.strictEqual(bad, 0, 'RICE rows decode exactly');
}
// 2. a full-size file on a real SPHEREx layout (shipped cutout: PRIMARY, IMAGE, FLAGS, ZODI, WCS-WAVE), with a fake star
const dir = path.join(__dirname, '..', 'demo-cache', 'cutouts');
const src = zlib.gunzipSync(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.gz')).sort()[0])));
const ab = src.buffer.slice(src.byteOffset, src.byteOffset + src.length), hd = F.parseFITS(ab);
const hi = hd[1], nx = hi.header.NAXIS1, ny = hi.header.NAXIS2, w0 = F.makeWCS(hi.header);
const full = Buffer.from(src);   // writable copy
const sx = Math.round(nx * 0.45) + 0.3, sy = Math.round(ny * 0.55) - 0.2, sig = 0.9, flux = 400;   // flux in MJy/sr * pixel
// clean the star's neighbourhood (a constant sky) so the test measures the method, not the real sky there
for (let y = Math.floor(sy) - 9; y <= Math.floor(sy) + 9; y++) for (let x = Math.floor(sx) - 9; x <= Math.floor(sx) + 9; x++) {
  const r2 = (x - sx) ** 2 + (y - sy) ** 2, v = 5 + flux * Math.exp(-r2 / (2 * sig * sig)) / (2 * Math.PI * sig * sig);
  full.writeFloatBE(v, hi.dataStart + (y * nx + x) * 4);
  const fl = hd.find(h => String(h.header.EXTNAME).trim() === 'FLAGS'); full.writeInt32BE(0, fl.dataStart + (y * nx + x) * 4);
}
const sky = F.pix2sky(w0, sx + 1, sy + 1);
let calls = 0;
const get = async (a, b) => { calls++; return { buf: new Uint8Array(full.subarray(a, Math.min(b + 1, full.length))), total: full.length }; };
(async () => {
  const memo = {}, url = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr2/level2/x/level2_2025W22_2B_0360_1D4_spx_l2b.fits';
  assert.strictEqual(SP.keyOf(url), 'qr2:4');
  const s = await SP.spot(get, url, sky[0], sky[1], 7, memo, F.badFlagMask(null).mask);
  const first = calls; calls = 0;
  assert.strictEqual(s.w, 15); assert.strictEqual(s.h, 15);
  assert.ok(Math.abs(s.cx - 7 - (sx - Math.round(sx))) < 1e-6 && Math.abs(s.cy - 7 - (sy - Math.round(sy))) < 1e-6, 'star position in the box');
  const x0 = Math.round(sx) - 7, y0 = Math.round(sy) - 7;
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) assert.strictEqual(s.data[j * 15 + i], full.readFloatBE(hi.dataStart + ((y0 + j) * nx + x0 + i) * 4));
  const lam = Wv.waveAtSky(F, ab, sky[0], sky[1]);
  assert.ok(lam && Math.abs(s.lam - lam.lam) < 1e-9, 'same wavelength as the full file: ' + s.lam);
  const ph = SP.photometry(s), want = flux * 1e9 * (6.15 / 206264.806) ** 2;
  assert.ok(ph.ok && Math.abs(ph.mJy / want - 1) < 0.03, `fake star: ${ph.mJy.toFixed(3)} mJy, put in ${want.toFixed(3)}`);
  // second file of the same release and detector: 2 header reads + IMAGE rows + FLAGS rows, no header walk
  const s2 = await SP.spot(get, url, sky[0], sky[1], 7, memo, F.badFlagMask(null).mask);
  assert.strictEqual(calls, 3, 'learned layout: 3 requests, was ' + first);
  assert.deepStrictEqual(Array.from(s2.data), Array.from(s.data));
  // a flagged pixel on the star -> not measured
  const fl = hd.find(h => String(h.header.EXTNAME).trim() === 'FLAGS'); full.writeInt32BE(1, fl.dataStart + (Math.round(sy) * nx + Math.round(sx)) * 4);
  const s3 = await SP.spot(get, url, sky[0], sky[1], 7, memo, F.badFlagMask(null).mask);
  assert.strictEqual(SP.photometry(s3).ok, false, 'flagged centre pixel is left out');
  // off the image
  const off = F.pix2sky(w0, -50, -50);
  await assert.rejects(SP.spot(get, url, off[0], off[1], 7, memo, 0), e => e.status === 404);
  console.log(`spot.test: RICE ok; pixels exact; first file ${first} requests, then 3; fake star ${ph.mJy.toFixed(2)} of ${want.toFixed(2)} mJy`);
})().catch(e => { console.error(e); process.exit(1); });
