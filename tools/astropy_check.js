// Prints our WCS answers (lib/fits.js) for a grid of pixels of one FITS file, as JSON, for tools/astropy_check.py to compare.
const fs = require('fs'), F = require('../lib/fits');
const buf = fs.readFileSync(process.argv[2]);
const hd = F.parseFITS(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), hi = F.findHDU(hd, 'IMAGE');
const w = F.makeWCS(hi.header), nx = hi.header.NAXIS1, ny = hi.header.NAXIS2, pts = [];
for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const x = (nx - 1) * i / 8, y = (ny - 1) * j / 8, s = F.pix2sky(w, x, y), back = F.sky2pix(w, s[0], s[1]); pts.push({ x, y, ra: s[0], dec: s[1], bx: back[0], by: back[1] }); }
console.log(JSON.stringify({ nx, ny, pts }));
