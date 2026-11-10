'use strict';
// /api/spherex/psf reader (server.js readPsfZone) on a synthetic SPHEREx-like file: IMAGE with the "A" detector WCS and a
// PSF cube of 11 x 11 zones. Each plane is filled with its own index, so we can see which plane was picked.
// Zone rule from IRSA's "PSF extension header error" note: plane = y * 11 + x, (0,0) = bottom-left zone.
process.env.SKYSHIFT_CACHE_DIR = require('path').join(require('os').tmpdir(), 'skyshift-psfzone-' + process.pid);
const assert = require('assert'), server = require('../server'), { readPsfZone } = server._test, F = require('../lib/fits');
const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
const hdr = cs => { const s = cs.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80); return Buffer.from(s.padEnd(Math.ceil(s.length / 2880) * 2880), 'ascii'); };
const dataBuf = (n, f) => { const b = Buffer.alloc(Math.ceil(n * 4 / 2880) * 2880); for (let k = 0; k < n; k++) b.writeFloatBE(f(k), k * 4); return b; };
const PX = 6.15 / 3600;
function file(detX, detY, headerSwapped) {   // a 40x40 cutout whose centre sits at detector pixel (detX, detY), 0-based
  const prim = hdr([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true], ['VERSION', '6.5.7']]);
  const img = Buffer.concat([hdr([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', 40], ['NAXIS2', 40], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', 'IMAGE'],
    ['CTYPE1', 'RA---TAN'], ['CTYPE2', 'DEC--TAN'], ['CRPIX1', 20.5], ['CRPIX2', 20.5], ['CRVAL1', 190], ['CRVAL2', -4], ['CD1_1', -PX], ['CD1_2', 0], ['CD2_1', 0], ['CD2_2', PX],
    // "0-based active pixel coordinates": det = CRVAL1A + (p - CRPIX1A); FITS pixel 20.5 is the centre
    ['CRPIX1A', 20.5 - detX], ['CRPIX2A', 20.5 - detY], ['CRVAL1A', 0], ['CRVAL2A', 0], ['CDELT1A', 1], ['CDELT2A', 1], ['PSF_FWHM', 6.61]]), dataBuf(1600, () => 0)]);
  const zw = 2040 / 11, cards = [['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 3], ['NAXIS1', 5], ['NAXIS2', 5], ['NAXIS3', 121], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', 'PSF'], ['OVERSAMP', 10]];
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) { const i = headerSwapped ? x * 11 + y + 1 : y * 11 + x + 1; cards.push(['XCTR_' + i, (x + 0.5) * zw + 1], ['YCTR_' + i, (y + 0.5) * zw + 1]); }
  const psf = Buffer.concat([hdr(cards), dataBuf(5 * 5 * 121, k => Math.floor(k / 25))]);
  return Buffer.concat([prim, img, psf]);
}
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok ', name); };
t('picks plane y*11+x for the zone holding the spot', () => {
  for (const [dx, dy] of [[10, 10], [2030, 10], [10, 2030], [1000, 1500], [190, 380]]) {
    const r = readPsfZone(file(dx, dy, false), 190, -4), zx = Math.floor(dx / (2040 / 11)), zy = Math.floor(dy / (2040 / 11));
    assert.ok(Math.abs(r.det.x - dx) < 0.01 && Math.abs(r.det.y - dy) < 0.01, JSON.stringify(r.det));
    assert.strictEqual(r.zone.plane, zy * 11 + zx); assert.strictEqual(r.data[0], zy * 11 + zx, 'data comes from that plane');
    assert.strictEqual(r.headerPlane, zy * 11 + zx, 'fixed header agrees');
  }
});
t('an old-style swapped header is reported, but the plane is still chosen by the correct rule', () => {
  const r = readPsfZone(file(1900, 100, true), 190, -4);   // zone x=10, y=0 -> plane 10
  assert.strictEqual(r.zone.plane, 10); assert.strictEqual(r.data[0], 10); assert.strictEqual(r.headerPlane, 110, "swapped header would pick x*11+y");
});
t('metadata: version, oversampling, header FWHM', () => {
  const r = readPsfZone(file(500, 500, false), 190, -4);
  assert.strictEqual(r.version, '6.5.7'); assert.strictEqual(r.oversamp, 10); assert.strictEqual(r.psfFwhmHeader, 6.61); assert.strictEqual(r.nz, 121);
});
console.log(`\n${pass} passed`); server.close && server.close();
