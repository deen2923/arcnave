// v0.57.8: the star shape (ePSF) of an image is now made in a Web Worker and sent back to the page. A worker's result is a
// structured-clone copy without its at() function; F.epsfRevive rebuilds at() from the copied grid. This checks, on the
// real SPHEREx fixture images, that the revived copy gives exactly the same numbers as the original (every lookup, and
// the fields the fits use), so measurements do not change because the work moved off the page's main thread.
const assert = require('assert'), fs = require('fs'), path = require('path'), { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads'), F = require('../lib/fits.js');
const FX = path.join(__dirname, 'fixtures'), meta = JSON.parse(fs.readFileSync(path.join(FX, 'real_pair.json'), 'utf8'));
const PX = 6.15 / 3600, fld = meta.field, n = Math.round(fld.size / PX), grid = { ra0: fld.ra, dec0: fld.dec, s: PX, n };
const load = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const opts = { half: 5, os: 4, minSnr: 25 };
// the same copy a postMessage makes (structuredClone), after the worker drops at() as public/prep-worker.js does
const viaWorker = P => { const c = structuredClone(Object.fromEntries(Object.entries(P).filter(([k]) => k !== 'at'))); return F.epsfRevive(c); };
let checked = 0;
for (const f of [meta.files.A, meta.files.B]) {
  const pc = F.prepareCutout(load(path.join(FX, f)), grid), st = F.robustStats(pc.flat);
  const P = F.epsfGrid(pc.flat, n, st, opts); assert.ok(P && P.nStars >= 8, 'an ePSF on the real image');
  const Q = viaWorker(P);
  assert.strictEqual(typeof Q.at, 'function');
  for (let dy = -6; dy <= 6; dy += 0.137) for (let dx = -6; dx <= 6; dx += 0.113) assert.strictEqual(Q.at(dx, dy), P.at(dx, dy), `at(${dx}, ${dy})`);
  for (const k of ['os', 'half', 'size', 'nStars', 'nCandidates', 'fwhm', 'peakFrac', 'shape', 'method']) assert.deepStrictEqual(Q[k], P[k], k);
  assert.deepStrictEqual([...Q.psf], [...P.psf]); assert.deepStrictEqual([...Q.ep], [...P.ep]);
  checked++;
}
// a result made on this thread (the fallback when workers are unavailable) is passed through untouched
const same = { at: () => 1, ep64: new Float64Array(1) }; assert.strictEqual(F.epsfRevive(same), same); assert.strictEqual(F.epsfRevive(null), null);
console.log(`epsfworker.test: ok (${checked} real images, worker copy of the ePSF identical)`);
