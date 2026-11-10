// QR3 files store FLAGS RICE-compressed (one tile per row). Field cutouts from such a file must give the same FLAGS as the
// uncompressed original. Fixture: a shipped QR2 cutout re-written by astropy with FLAGS as CompImageHDU(RICE_1, tile 1 row),
// the same layout as real QR3 files (BINTABLE, NAXIS1 = 8, ZTILE1 = width, ZTILE2 = 1).
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const F = require('../lib/fits'), C = require('../lib/s3cut');
const dir = path.join(__dirname, '..', 'demo-cache', 'cutouts');
// The fixture's source, named (OBSID 2026W22_2A_0570_3, detector 6). It used to be "the first file in demo-cache", which
// stopped being this one when more example images were added (v0.52 found the test reading a different image).
const SRC = '00ef98dab279732be1a74d2c4fc178cba7fa7104.fits.gz';
if (!fs.existsSync(path.join(dir, SRC))) { console.error('s3cut_rice.test: the fixture source ' + SRC + ' is missing from demo-cache/cutouts'); process.exit(1); }
const plain = zlib.gunzipSync(fs.readFileSync(path.join(dir, SRC)));
const rice = fs.readFileSync(path.join(__dirname, 'fixtures', 'qr3like_rice_flags.fits'));
const getter = buf => async (a, b) => ({ buf: new Uint8Array(buf.subarray(a, Math.min(b + 1, buf.length))), total: buf.length });
const ab = u => u.buffer.slice(u.byteOffset, u.byteOffset + u.length);
(async () => {
  const hd = F.parseFITS(ab(plain)), w0 = F.makeWCS(hd[1].header), nx = hd[1].header.NAXIS1, ny = hd[1].header.NAXIS2;
  const centre = F.pix2sky(w0, nx * 0.45, ny * 0.55);
  const a = await C.cutout(getter(plain), centre[0], centre[1], 0.2), b = await C.cutout(getter(rice), centre[0], centre[1], 0.2);
  const A = F.parseFITS(ab(a.fits)), B = F.parseFITS(ab(b.fits)), fa = A.find(h => h.header.EXTNAME === 'FLAGS'), fb = B.find(h => h.header.EXTNAME === 'FLAGS');
  assert.ok(fb && fb.header.XTENSION === 'IMAGE' && fb.header.BITPIX === 32 && !fb.header.ZIMAGE, 'decoded FLAGS is a plain 32-bit image');
  assert.strictEqual(fb.header.NAXIS1, fa.header.NAXIS1); assert.strictEqual(fb.header.NAXIS2, fa.header.NAXIS2);
  const va = F.readFlags(ab(a.fits), fa).data, vb = F.readFlags(ab(b.fits), fb).data;
  let diff = 0, nz = 0; for (let i = 0; i < va.length; i++) { if (va[i] !== vb[i]) diff++; if (va[i]) nz++; }
  assert.strictEqual(diff, 0, 'FLAGS identical'); assert.ok(nz > 100, 'with real flags in it: ' + nz);
  // the app's processing gives the same result from both
  const g = { ra0: centre[0], dec0: centre[1], s: 6.15 / 3600, n: 100 };
  const pa = F.prepareCutout(ab(a.fits), g), pb = F.prepareCutout(ab(b.fits), g);
  assert.deepStrictEqual(pa.mask, pb.mask);
  let dd = 0; for (let i = 0; i < pa.flat.length; i++) if (!(pa.flat[i] === pb.flat[i] || (isNaN(pa.flat[i]) && isNaN(pb.flat[i])))) dd++;
  assert.strictEqual(dd, 0, 'same processed image');
  console.log(`ok  S3 cutout of RICE FLAGS (QR3 layout): ${va.length} flag values identical (${nz} non-zero), ${b.requests} range reads, same processed image and masks`);
})().catch(e => { console.error(e); process.exit(1); });
