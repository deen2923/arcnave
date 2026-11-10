'use strict';
// Independent GIF decoder for the tests (frames as palette indices, delays, loop count).
const assert = require('assert');

function decode(buf) {
  let p = 0;
  const u8 = () => buf[p++], u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  assert.strictEqual(String.fromCharCode(...buf.slice(0, 6)), 'GIF89a'); p = 6;
  const w = u16(), hgt = u16(), pk = u8(); u8(); u8();
  const pal = []; const n = 1 << ((pk & 7) + 1);
  for (let i = 0; i < n; i++) pal.push([u8(), u8(), u8()]);
  const frames = []; let delay = 0, loop = null;
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); u8(); delay = u16() * 10; u8(); u8(); continue; }
      let s; const blocks = [];
      while ((s = u8())) { blocks.push(buf.slice(p, p + s)); p += s; }
      if (label === 0xff && String.fromCharCode(...blocks[0]) === 'NETSCAPE2.0') loop = blocks[1][1] | (blocks[1][2] << 8);
      continue;
    }
    assert.strictEqual(b, 0x2c);
    u16(); u16(); const fw = u16(), fh = u16(); u8();
    const min = u8(); const data = []; let s;
    while ((s = u8())) { for (let i = 0; i < s; i++) data.push(buf[p + i]); p += s; }
    // LZW decode
    const CLEAR = 1 << min, EOI = CLEAR + 1, out = [];
    let size = min + 1, dict = [], prev = null, bit = 0;
    const reset = () => { dict = []; for (let i = 0; i < CLEAR; i++) dict[i] = [i]; dict[CLEAR] = []; dict[EOI] = null; size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === CLEAR) { reset(); continue; }
      if (code === EOI) break;
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (code === dict.length && prev) entry = prev.concat(prev[0]);
      else throw new Error('bad code ' + code + ' at ' + bit);
      out.push(...entry);
      if (prev && dict.length < 4096) dict.push(prev.concat(entry[0]));
      if (dict.length === (1 << size) && size < 12) size++;
      prev = entry;
    }
    assert.strictEqual(out.length, fw * fh, 'pixel count');
    frames.push({ idx: out, delay });
  }
  return { w, hgt, pal, frames, loop };
}
module.exports = { decode };
