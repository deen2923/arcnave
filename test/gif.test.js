'use strict';
// Discovery card GIF encoder: decode what public/gif.js writes with an independent decoder and compare pixels.
const assert = require('assert');
const G = require('../public/gif.js');

const { decode } = require('./gifdecode');

// Synthetic card: noisy "sky" with a gradient (many colours), white text-like block, an orange ring, two frames.
const W = 173, H = 131;   // odd sizes on purpose
function frame(shift) {
  const a = new Uint8ClampedArray(W * H * 4);
  let seed = 7 + shift;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, v = Math.min(255, 20 + x + 40 * rnd());
    a[o] = v; a[o + 1] = 0.8 * v; a[o + 2] = 60 + 0.5 * y; a[o + 3] = 255;
    if (y < 12) { a[o] = 0xee; a[o + 1] = 0xf1; a[o + 2] = 0xf7; }                                   // header text colour
    if (Math.abs(Math.hypot(x - 80 - shift, y - 70) - 15) < 1.2) { a[o] = 0xff; a[o + 1] = 0xb0; a[o + 2] = 0x5a; }   // ring
  }
  return a;
}
const frames = [frame(0), frame(9), frame(18)];
const gif = G.encode({ width: W, height: H, frames: frames.map((rgba, i) => ({ rgba, delay: i === 2 ? 1400 : 700 })) });
const d = decode(gif);
assert.strictEqual(d.w, W); assert.strictEqual(d.hgt, H); assert.strictEqual(d.frames.length, 3); assert.strictEqual(d.loop, 0);
assert.deepStrictEqual(d.frames.map(f => f.delay), [700, 700, 1400]);
let worst = 0, sum = 0, cnt = 0;
d.frames.forEach((f, k) => {
  const src = frames[k];
  for (let i = 0; i < f.idx.length; i++) {
    const c = d.pal[f.idx[i]], o = i * 4, e = Math.max(Math.abs(c[0] - src[o]), Math.abs(c[1] - src[o + 1]), Math.abs(c[2] - src[o + 2]));
    worst = Math.max(worst, e); sum += e; cnt++;
    if (src[o] === 0xff && src[o + 1] === 0xb0 && src[o + 2] === 0x5a) assert.strictEqual(e, 0, 'ring colour is exact');
    if (src[o] === 0xee && src[o + 1] === 0xf1 && src[o + 2] === 0xf7) assert.strictEqual(e, 0, 'text colour is exact');
  }
});
assert.ok(sum / cnt < 8, 'mean colour error ' + (sum / cnt).toFixed(2));
assert.ok(worst < 64, 'worst colour error ' + worst);

// Long flat runs force the 4096-code dictionary to fill and clear: must still decode exactly.
const big = new Uint8ClampedArray(400 * 300 * 4);
for (let i = 0; i < 400 * 300; i++) { const v = (i * 7919) % 251; big[i * 4] = v; big[i * 4 + 1] = (v * 3) & 255; big[i * 4 + 2] = (v * 5) & 255; big[i * 4 + 3] = 255; }
const d2 = decode(G.encode({ width: 400, height: 300, frames: [{ rgba: big, delay: 500 }] }));
assert.strictEqual(d2.frames[0].idx.length, 400 * 300);
console.log(`gif.test: ok (${gif.length} bytes, mean error ${(sum / cnt).toFixed(2)}, worst ${worst})`);
