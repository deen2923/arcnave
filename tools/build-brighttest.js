#!/usr/bin/env node
/* ARCNAVE: turn the brightness-change run (scorecard/bright_<id>.json, written by the #brighttest mode of the page) into the
   small public/brighttest.json shown in the Tested panel. Every field is kept, also those that could not be measured.
   Usage: node tools/build-brighttest.js [scorecard-dir] [out-file] */
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'scorecard');
const out = process.argv[3] || path.join(__dirname, '..', 'public', 'brighttest.json');
const PLANE = 5;
const rows = fs.readdirSync(dir).filter(f => /^bright_L\d{3}B[+-]\d{2}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(r => ({
  id: r.field, ra: r.ra, dec: r.dec, eclLon: r.eclLon, eclLat: r.eclLat, galLat: r.galLat, status: r.status, error: r.error || null,
  stars: r.stars ? r.stars.length : 0, byGain: r.byGain || null, measuredAt: r.startedAt
})).sort((a, b) => (a.eclLat - b.eclLat) || (a.eclLon - b.eclLon));
const ok = rows.filter(r => r.status === 'ok'), gains = ok.length ? ok[0].byGain.map(g => g.gain) : [];
const sum = L => gains.map((g, j) => { const c = L.reduce((a, r) => a + r.byGain[j].caught, 0), of = L.reduce((a, r) => a + r.byGain[j].of, 0); return { gain: g, caught: c, of, pct: of ? Math.round(100 * c / of) : null }; });
const summary = { fields: rows.length, measured: ok.length, stars: ok.reduce((a, r) => a + r.stars, 0), all: sum(ok),
  plane: sum(ok.filter(r => Math.abs(r.galLat) < PLANE)), rest: sum(ok.filter(r => Math.abs(r.galLat) >= PLANE)), planeDeg: PLANE,
  method: 'real isolated stars made brighter by a known factor in every image of the last pass; the Changes view (changeMaps, 8 sigma, 25 % rule on a 5x5 box) must report them' };
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), summary, rows }, null, 1));
console.log(`${rows.length} fields, ${ok.length} measured, ${summary.stars} stars; ` + summary.all.map(g => `x${g.gain}: ${g.pct}%`).join(', ') + ` -> ${out}`);
