// v0.38: no read-ahead past the end of a file. A hint learned from a BIGGER file asked for header windows beyond this
// file's end; S3 answers 416 and browsers print that as a red console error. Now: offsets past the smallest file seen so far
// wait for the first answer (which gives this file's size), and are dropped if they are past its end.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const F = require('../lib/fits'), C = require('../lib/s3cut');
const dir = path.join(__dirname, '..', 'demo-cache', 'cutouts');
const buf = zlib.gunzipSync(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.gz')).sort()[0])));
const ab = u => u.buffer.slice(u.byteOffset, u.byteOffset + u.length);
(async () => {
  let past = 0, calls = 0;
  const get = async (a, b) => { calls++; if (a >= buf.length) { past++; const e = new Error('S3 HTTP 416'); e.status = 416; throw e; } return { buf: new Uint8Array(buf.subarray(a, Math.min(b + 1, buf.length))), total: buf.length }; };
  const hd = F.parseFITS(ab(buf)), w = F.makeWCS(hd[1].header), c = F.pix2sky(w, hd[1].header.NAXIS1 / 2, hd[1].header.NAXIS2 / 2);
  const one = await C.cutout(get, c[0], c[1], 0.2);
  assert.strictEqual(one.offsets.minTotal, buf.length, 'the file size is learned with the offsets');
  // a hint from a bigger file: its last header lies past this file's end
  const hint = [...one.offsets, buf.length + 50000]; hint.minTotal = buf.length;
  past = 0; calls = 0;
  const two = await C.cutout(get, c[0], c[1], 0.2, hint);
  assert.strictEqual(past, 0, 'no request past the end of the file');
  assert.ok(two.fits.length > 0);
  console.log(`ok  S3 read-ahead stops at the file's end: 0 requests past it (${calls} reads with the hint)`);
})().catch(e => { console.error(e); process.exit(1); });
