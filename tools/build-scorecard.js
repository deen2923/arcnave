#!/usr/bin/env node
/* ARCNAVE: turn the scorecard run (scorecard/<id>.json, written by the #scorecard mode of the page) into the small
   public/scorecard.json the app shows in Learn. Every field of the fixed grid is kept, including fields with no data,
   one pass only, or a failure, so nothing is hidden. Usage: node tools/build-scorecard.js [scorecard-dir] [out-file] */
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'scorecard');
const out = process.argv[3] || path.join(__dirname, '..', 'public', 'scorecard.json');
// Fields run a second time, and why. Only failures that had nothing to do with the result are retried, and they are named
// in the app. The v0.30 run (2026-10-26) needed none. (The v0.12 run retried L180B+00 after an IRSA 503 and L300B+00 after a
// runner bug.)
const RETRIED = {};
const at = (r, d, k = 'limits') => { const l = r.map && r.map[k] && r.map[k].find(x => x.dist === d); return l ? l.ab50 : null; };
const shifted = r => !!(r.map && r.map.limitsPlain);   // v0.30 run: the limits use the motion-following stack, limitsPlain do not
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !/^summary|^TEST|^null_|^bright_/.test(f));
const rows = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(r => ({
  id: r.id, ra: r.ra, dec: r.dec, eclLon: r.eclLon, eclLat: r.eclLat, galLat: r.galLat, status: r.status,
  images: r.images ?? null, epochs: r.epochs ?? null, perEpoch: r.perEpoch ?? null, dates: r.epochDates || [], pair: r.pair || null, earthAU: r.earthAU ?? null,
  psfStars: r.psf ? r.psf.stars : null, fwhmArcsec: r.psf ? r.psf.fwhmArcsec : null, noiseAB: r.noiseLimitAB ?? null,
  // the limit at 300 and at 1000 AU separately: a planet near 300 AU can be erased by the median stack when the images of
  // one pass are spread over weeks (it moves tens of pixels), so one number for 300-1000 AU would hide that
  lim300: at(r, 300), lim1000: at(r, 1000), limits: r.map ? r.map.limits : null,
  lim300plain: shifted(r) ? at(r, 300, 'limitsPlain') : null, lim1000plain: shifted(r) ? at(r, 1000, 'limitsPlain') : null,
  // motion-following stack over the whole real field with no fake planet: unexplained peaks summed over distances and passes
  scanLone: r.shiftScan ? r.shiftScan.reduce((a, x) => a + x.lone7[0] + x.lone7[1], 0) : null, scanPairs: r.shiftScan ? r.shiftScan.reduce((a, x) => a + x.pairs5, 0) : null, fakes: r.map ? r.map.cells.reduce((s, c) => s + c[4], 0) : 0,
  retried: RETRIED[r.id] || null, error: r.error ? String(r.error).replace(/<title>([^<]*)<\/title>[\s\S]*/, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : null, measuredAt: r.startedAt
})).sort((a, b) => (a.eclLat - b.eclLat) || (a.eclLon - b.eclLon));
const ok = rows.filter(r => r.status === 'ok');
const stats = k => { const L = ok.map(r => r[k]).filter(v => v != null).sort((a, b) => a - b), n = L.length;
  return { found: n, of: ok.length, median: n ? (n & 1 ? L[n >> 1] : (L[n / 2 - 1] + L[n / 2]) / 2) : null, min: n ? L[0] : null, max: n ? L[n - 1] : null }; };
const summary = { fields: rows.length, measured: ok.length, at1000: stats('lim1000'), at300: stats('lim300'),
  shift: ok.some(r => r.scanLone !== null), at1000plain: stats('lim1000plain'), at300plain: stats('lim300plain'),
  scanFields: ok.filter(r => r.scanLone !== null).length, scanLoneFields: ok.filter(r => r.scanLone > 0).length, scanLoneMax: Math.max(0, ...ok.map(r => r.scanLone || 0)),
  scanPairs: ok.reduce((a, r) => a + (r.scanPairs || 0), 0), scanDists: 7,
  fakes: rows.reduce((s, r) => s + r.fakes, 0), grid: 'ecliptic longitude 0, 60 ... 300 deg x latitude 0, +40, -40 deg, fixed before the run',
  settings: '8 images per epoch, 0.5 deg field, the same detectability map as the Hide Planet X tab',
  retried: Object.entries(RETRIED).map(([id, why]) => `${id}: ${why}`) };
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), summary, rows }, null, 1));
console.log(`${rows.length} fields, ${ok.length} measured; 1000 AU: ${JSON.stringify(summary.at1000)}; 300 AU: ${JSON.stringify(summary.at300)} -> ${out}`);
