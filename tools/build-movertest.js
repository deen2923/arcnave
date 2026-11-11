#!/usr/bin/env node
/* ARCNAVE v0.55: turn the mover test run (scorecard/mover_<id>.json, written by the #movertest mode of the page) into the
   small public/movertest.json shown in the Tested panel. Every field of the fixed grid is kept, also those that could not
   be measured. Usage: node tools/build-movertest.js [scorecard-dir] [out-file] */
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'scorecard');
const out = process.argv[3] || path.join(__dirname, '..', 'public', 'movertest.json');
const PLANE = 5;   // |galactic latitude| below this = Milky Way plane (as the false-alarm test)
const rows = fs.readdirSync(dir).filter(f => /^mover_L\d{3}B[+-]\d{2}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(r => ({
  id: r.field, ra: r.ra, dec: r.dec, eclLon: r.eclLon, eclLat: r.eclLat, galLat: r.galLat, status: r.status, epochs: r.epochs ?? null,
  fakes: r.fakes ?? null, nImg: r.nImg ?? null, days: r.days ?? null, floor: r.floor ?? null, cells: r.cells || null, pulls: r.pulls || 0, pullRms: r.pullRms ?? null,
  empty: r.empty ?? null, emptyFalse: r.emptyFalse ?? null, emptyWander: r.emptyWander ?? null, extra: r.extra ?? null, dsFlagged: r.dsFlagged ?? null,
  why: r.status === 'too-few-passes' ? 'fewer than three passes so far' : r.status === 'error' ? String(r.error || '').slice(0, 120) : null, measuredAt: r.startedAt
})).sort((a, b) => (a.eclLat - b.eclLat) || (a.eclLon - b.eclLon));
const ok = rows.filter(r => r.status === 'ok' && r.cells);
const SNR = ok[0] ? ok[0].SNR || [3, 6, 12, 25] : [3, 6, 12, 25], MU = ok[0] ? ok[0].MU || [1, 2, 4, 8] : [1, 2, 4, 8];
const first = rows.find(r => r.status === 'ok'); const raw = first && JSON.parse(fs.readFileSync(path.join(dir, 'mover_' + first.id + '.json'), 'utf8'));
const snr = raw && raw.SNR || SNR, mu = raw && raw.MU || MU;
const grid = L => snr.map((_, i) => mu.map((_, j) => { const c = L.map(r => r.cells[i] && r.cells[i][j]).filter(Boolean); return { n: c.reduce((a, x) => a + x.n, 0), meas: c.reduce((a, x) => a + x.meas, 0), blind: c.reduce((a, x) => a + x.blind, 0) }; }));
const pull = L => { const P = L.filter(r => r.pullRms != null && r.pulls); const n = P.reduce((a, r) => a + r.pulls, 0); return n ? +Math.sqrt(P.reduce((a, r) => a + r.pulls * r.pullRms ** 2, 0) / n).toFixed(2) : null; };
const grp = L => ({ fields: L.length, cells: grid(L), pullRms: pull(L), empty: L.reduce((a, r) => a + (r.empty || 0), 0), emptyFalse: L.reduce((a, r) => a + (r.emptyFalse || 0), 0), extra: L.reduce((a, r) => a + (r.extra || 0), 0) });
const summary = { fields: rows.length, measured: ok.length, SNR: snr, MU: mu, all: grp(ok), plane: grp(ok.filter(r => Math.abs(r.galLat) < PLANE)), rest: grp(ok.filter(r => Math.abs(r.galLat) >= PLANE)), planeDeg: PLANE,
  days: ok.length ? Math.round(ok.reduce((a, r) => a + r.days, 0) / ok.length) : null,
  method: 'fake moving stars of known speed and brightness added to the real images of each field, then measured at their known place and searched for blind by the deep search; images restored afterwards' };
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), summary, rows }, null, 1));
console.log(`${rows.length} fields, ${ok.length} measured; pulls ${summary.all.pullRms}; empty false ${summary.all.emptyFalse}/${summary.all.empty}; new flags ${summary.all.extra} -> ${out}`);
