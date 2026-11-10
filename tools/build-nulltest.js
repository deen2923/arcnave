#!/usr/bin/env node
/* ARCNAVE: turn the false-alarm run (scorecard/null_<id>.json, written by the #nulltest mode of the page) into the small
   public/nulltest.json shown in the Tested panel. Every field of the fixed grid is kept, also those that could not be
   measured. Usage: node tools/build-nulltest.js [scorecard-dir] [out-file] */
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'scorecard');
const out = process.argv[3] || path.join(__dirname, '..', 'public', 'nulltest.json');
const CAP = 50;   // findTransients keeps at most 50 changes per comparison
const PLANE = 5;  // |galactic latitude| below this = Milky Way plane (the app warns there)
const rows = fs.readdirSync(dir).filter(f => /^null_L\d{3}B[+-]\d{2}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(r => {
  const ok = (r.splits || []).filter(s => !s.skipped), ctl = ab => { const c = ok.flatMap(s => (s.control || []).filter(x => x.ab === ab)); return c.length ? { found: c.reduce((a, x) => a + x.found, 0), of: c.reduce((a, x) => a + x.hidden, 0) } : null; };
  return { id: r.field, ra: r.ra, dec: r.dec, eclLon: r.eclLon, eclLat: r.eclLat, galLat: r.galLat, status: r.status,
    comparisons: ok.length, falseAlarms: r.status === 'ok' ? r.falseAlarms : null, capped: ok.some(s => s.raw >= CAP), real: r.real ? r.real.changes : null,
    control: { 14: ctl(14), 15: ctl(15), 16: ctl(16) }, why: r.status === 'no-split' ? 'fewer than 4 colours with an image in both passes' : r.status === 'error' ? String(r.error || '').slice(0, 120) : null, measuredAt: r.startedAt };
}).sort((a, b) => (a.eclLat - b.eclLat) || (a.eclLon - b.eclLon));
const ok = rows.filter(r => r.status === 'ok'), sum = (L, k) => L.reduce((a, r) => a + r[k], 0);
const grp = L => ({ fields: L.length, comparisons: sum(L, 'comparisons'), falseAlarms: sum(L, 'falseAlarms'), zeroFields: L.filter(r => r.falseAlarms === 0).length, capped: L.some(r => r.capped) });
const summary = { fields: rows.length, measured: ok.length, comparisons: sum(ok, 'comparisons'), falseAlarms: sum(ok, 'falseAlarms'), plane: grp(ok.filter(r => Math.abs(r.galLat) < PLANE)),
  rest: grp(ok.filter(r => Math.abs(r.galLat) >= PLANE)), planeDeg: PLANE, cap: CAP,
  method: 'two colour-matched stacks of the same two passes that differ in nothing real; every change reported between them is a false alarm' };
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), summary, rows }, null, 1));
console.log(`${rows.length} fields, ${ok.length} measured; plane ${JSON.stringify(summary.plane)}; rest ${JSON.stringify(summary.rest)} -> ${out}`);
