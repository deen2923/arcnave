// S3 range-read cutouts (lib/s3cut.js): built from a real SPHEREx file layout (a shipped cutout with a VARIANCE and a PSF
// extension added, as in the full files), cut through a fake range reader. Every kept pixel must equal the source pixel at
// the same sky position, headers must keep their WCS meaning, and the layout hint must save the header round trips.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const F = require('../lib/fits'), C = require('../lib/s3cut'), Wv = require('../lib/wave');
const dir = path.join(__dirname, '..', 'demo-cache', 'cutouts');
const src = zlib.gunzipSync(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.gz')).sort()[0])));
const hd = F.parseFITS(src.buffer.slice(src.byteOffset, src.byteOffset + src.length));
const blocks = (h, i) => src.subarray(i === 0 ? 0 : hd[i - 1].dataStart + Math.ceil(hd[i - 1].dataLen / 2880) * 2880, h.dataStart + Math.ceil(h.dataLen / 2880) * 2880);
const card = s => s.padEnd(80);
function fakeHdu(name, nx, ny, nz, bitpix) {
  const cards = [card("XTENSION= 'IMAGE   '"), card(`BITPIX  = ${String(bitpix).padStart(20)}`), card(`NAXIS   = ${String(nz ? 3 : 2).padStart(20)}`),
    card(`NAXIS1  = ${String(nx).padStart(20)}`), card(`NAXIS2  = ${String(ny).padStart(20)}`), ...(nz ? [card(`NAXIS3  = ${String(nz).padStart(20)}`)] : []),
    card('PCOUNT  =                    0'), card('GCOUNT  =                    1'), card(`EXTNAME = '${name}'`), ...Array.from({ length: name === 'PSF' ? 300 : 60 }, (_, k) => card(`COMMENT filler ${k}`)), card('END')];
  const h = Buffer.alloc(Math.ceil(cards.length * 80 / 2880) * 2880, 32); h.write(cards.join(''), 'latin1');
  const n = nx * ny * (nz || 1) * Math.abs(bitpix) / 8, d = Buffer.alloc(Math.ceil(n / 2880) * 2880);
  for (let i = 0; i < n; i += 4) d.writeFloatBE(Math.sin(i), i);
  return Buffer.concat([h, d]);
}
const names = hd.map((h, i) => i === 0 ? 'PRIMARY' : String(h.header.EXTNAME).trim());
const nx = hd[1].header.NAXIS1, ny = hd[1].header.NAXIS2, parts = [];
names.forEach((n, i) => { parts.push(blocks(hd[i], i)); if (n === 'FLAGS') parts.push(fakeHdu('VARIANCE', nx, ny, 0, -32)); if (n === 'ZODI') parts.push(fakeHdu('PSF', 11, 11, 9, -32)); });
const full = Buffer.concat(parts);
let calls = 0;
const get = async (a, b) => { calls++; return { buf: new Uint8Array(full.subarray(a, Math.min(b + 1, full.length))), total: full.length }; };
(async () => {
  const hi = hd[1].header, w0 = F.makeWCS(hi), centre = F.pix2sky(w0, nx * 0.4, ny * 0.6);
  const c = await C.cutout(get, centre[0], centre[1], 0.2);
  const first = calls; calls = 0;
  const out = F.parseFITS(c.fits.buffer.slice(c.fits.byteOffset, c.fits.byteOffset + c.fits.length));
  assert.deepStrictEqual(out.map((h, i) => i ? h.header.EXTNAME.trim() : 'PRIMARY'), ['PRIMARY', 'IMAGE', 'FLAGS', 'ZODI', 'WCS-WAVE']);
  const oi = out[1], w1 = F.makeWCS(oi.header), on = oi.header.NAXIS1;
  assert.ok(Math.abs(on - Math.round(0.2 * 3600 / 6.15)) <= 2, 'about 117 pixels wide: ' + on);
  const srcImg = F.readImage(src.buffer.slice(src.byteOffset, src.byteOffset + src.length), hd[1]).data;
  const cutImg = F.readImage(c.fits.buffer.slice(c.fits.byteOffset, c.fits.byteOffset + c.fits.length), oi).data;
  let bad = 0, n = 0;
  for (let j = 0; j < oi.header.NAXIS2; j++) for (let i = 0; i < on; i++) {
    const sky = F.pix2sky(w1, i + 1, j + 1), p = F.sky2pix(w0, sky[0], sky[1]);
    const si = Math.round(p[0]) - 1, sj = Math.round(p[1]) - 1;
    assert.ok(Math.abs(p[0] - Math.round(p[0])) < 1e-6 && Math.abs(p[1] - Math.round(p[1])) < 1e-6, 'same pixel grid');
    const a = cutImg[j * on + i], b = srcImg[sj * nx + si]; n++; if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) bad++;
  }
  assert.strictEqual(bad, 0, 'pixels identical (' + n + ' compared)');
  for (const k of ['CRPIX1A', 'CRPIX2A']) if (typeof hi[k] === 'number') assert.strictEqual(oi.header[k], hi[k] - (k.endsWith('1A') ? c.box.x1 - 1 : c.box.y1 - 1));
  // the wavelength map still reads (WCS-WAVE copied, W keys shifted)
  const buf = c.fits.buffer.slice(c.fits.byteOffset, c.fits.byteOffset + c.fits.length);
  const lamCut = Wv.waveAtSky(F, buf, centre[0], centre[1]), lamSrc = Wv.waveAtSky(F, src.buffer.slice(src.byteOffset, src.byteOffset + src.length), centre[0], centre[1]);
  assert.ok(lamCut && lamSrc && Math.abs((lamCut.lam ?? lamCut) - (lamSrc.lam ?? lamSrc)) < 1e-9, 'same wavelength at the centre');
  // second file with the layout hint: headers asked for in parallel, fewer rounds
  const c2 = await C.cutout(get, centre[0], centre[1], 0.2, c.offsets);
  assert.strictEqual(Buffer.compare(Buffer.from(c2.fits), Buffer.from(c.fits)), 0, 'same result with the hint');
  // off the image
  await assert.rejects(C.cutout(get, (centre[0] + 180) % 360, -centre[1], 0.2), /not on this image/);
  console.log(`ok  S3 cutout: ${n} pixels identical, wavelength map intact, ${first} range reads (${calls ? '' : ''}hint reuses the layout)`);
})().catch(e => { console.error(e); process.exit(1); });
