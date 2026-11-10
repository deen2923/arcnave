'use strict';
const W = require('./wave');
// Pure parsing helpers for the upstream services. No network here, so they can be unit tested.

/** Minimal RFC4180 CSV parser (handles quotes and embedded commas). Returns array of objects. */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** SPHEREx TAP rows -> normalised image records (wavelengths in microns, times in MJD). */
function normaliseSpherex(rows) {
  const out = [];
  for (const r of rows) {
    const t0 = parseFloat(r.time_bounds_lower), t1 = parseFloat(r.time_bounds_upper);
    const e0 = parseFloat(r.energy_bounds_lower) * 1e6, e1 = parseFloat(r.energy_bounds_upper) * 1e6;
    if (![t0, t1, e0, e1].every(Number.isFinite) || !r.download_url) continue;
    const m = /\?([^/]+)/.exec(r.obs_publisher_did || '');
    const poly = r.poly ? W.polyFromWKB(r.poly) : null;
    out.push({
      url: r.download_url,
      id: m ? m[1] : r.obs_publisher_did,
      det: String(r.energy_bandpassname || '').replace(/^.*-/, ''),
      mjd: (t0 + t1) / 2,
      lam0: e0, lam1: e1, lam: (e0 + e1) / 2,
      // Footprint corners (detector pixel (0,0), (2039,0), (2039,2039), (0,2039)), rounded to ~0.4 arcsec. Lets the browser
      // predict each image's real wavelength and coverage at the field without downloading it.
      ...(poly ? { poly: poly.slice(0, 4).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) } : {}),
    });
  }
  return out.sort((a, b) => a.mjd - b.mjd);
}

/** CDS Sesame "-oI" plain text -> {ra,dec,name} or null. Looks for the "%J ra dec" line. */
function parseSesame(text) {
  const m = /^%J\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/m.exec(text);
  if (!m) return null;
  const nm = /^%I\.0\s+(.+)$/m.exec(text);
  return { ra: parseFloat(m[1]), dec: parseFloat(m[2]), name: nm ? nm[1].trim() : null };
}

/** "12 34 56.7" / "12:34:56.7" / "-12 34 56" -> decimal number in the same unit (hours or degrees). */
function parseSexa(s) {
  if (typeof s === 'number') return s;
  const t = String(s).trim();
  const neg = t.startsWith('-');
  const p = t.replace(/^[+-]/, '').split(/[\s:]+/).map(Number);
  if (!p.length || p.some(x => !Number.isFinite(x))) return NaN;
  const v = p[0] + (p[1] || 0) / 60 + (p[2] || 0) / 3600;
  return neg ? -v : v;
}

/** SkyBoT JSON (output=basic/all) -> objects with decimal-degree positions. */
function parseSkybot(text) {
  let j;
  // Only a blank reply or an explicit "nothing found" message counts as an empty result.
  // Anything else that is not JSON (e.g. a VOTable) is an error, never a silent "0 objects".
  try { j = JSON.parse(text); } catch { return { ok: /^\s*$|no (solar system )?(object|body)|nothing found/i.test(text), items: [], raw: text.slice(0, 200) }; }
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : null);
  if (!arr) return { ok: false, items: [], raw: text.slice(0, 200) };
  const items = [];
  for (const o of arr) {
    // Real SkyBoT JSON (output=basic) uses "RA (hms)" / "DEC (dms)"; older docs say "RA (hour)" / "DEC (deg)".
    const ra = parseSexa(o['RA (hms)'] ?? o['RA (hour)'] ?? o.RA) * 15, dec = parseSexa(o['DEC (dms)'] ?? o['DEC (deg)'] ?? o.DEC);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    items.push({
      num: o.Num === '' || o.Num == null ? null : o.Num,
      name: o.Name,
      cls: o.Class,
      vmag: Number(o['VMag (mag)']),
      err: Number(o['Err (arcsec)']),
      dra: Number(o['dRA (arcsec/h)']),   // arcsec per hour, includes cos(dec)
      ddec: Number(o['dDEC (arcsec/h)']),
      dgeo: Number(o['dg (ua)']),
      dsun: Number(o['dh (ua)']),
      ra, dec,
    });
  }
  // A non-empty list where nothing could be read means the format changed: report it, do not hide it.
  if (arr.length && !items.length) return { ok: false, items, raw: text.slice(0, 200) };
  return { ok: true, items };
}

/** MPC "MPChecker" reply (mpcheck.cgi, HTML) -> the same objects as parseSkybot.
 *  Rows look like:  (3865) Lindbloom       12 39 48.0 -04 12 30  16.8   0.4W   1.6S    17+     0+   32o  None needed ...
 *  Positions are printed to 0.1 s / 1 arcsec, motions to 1 arcsec per hour (R.A. motion includes cos dec, east and north
 *  positive: checked against two query times at Dec +59). The MPC gives no orbit class, distances or position errors. */
function parseMpc(text) {
  const plain = String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (/No known minor planets|No known objects/i.test(plain)) return { ok: true, items: [] };
  const rx = /^\s*(?:\((\d+)\)\s+)?(\S.*?)\s+(\d\d \d\d \d\d(?:\.\d+)?)\s+([+-]\d\d \d\d \d\d(?:\.\d+)?)\s+(?:(\d+\.\d)\s+)?[\d.]+[EW]\s+[\d.]+[NS]\s+(\d+)([+-])\s+(\d+)([+-])/;
  const items = []; let looked = 0;
  for (const line of plain.split('\n')) {
    if (!/\s\d\d \d\d \d\d(\.\d+)?\s+[+-]\d\d \d\d \d\d/.test(line)) continue;
    looked++;
    const m = rx.exec(line); if (!m) continue;
    const ra = parseSexa(m[3]) * 15, dec = parseSexa(m[4]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    items.push({
      num: m[1] ? +m[1] : null, name: m[2].trim(), cls: null,
      vmag: m[5] ? +m[5] : NaN, err: 2,   // 2": the rounding of the printed position; not an orbit error (the MPC does not give one)
      dra: (m[7] === '-' ? -1 : 1) * +m[6], ddec: (m[9] === '-' ? -1 : 1) * +m[8],
      dgeo: null, dsun: null, ra, dec,
    });
  }
  if (looked && !items.length) return { ok: false, items, raw: plain.slice(0, 200) };
  // no table and no "none found" sentence: an error page or a changed format, never a silent "0 objects"
  if (!looked && !/were found in the/i.test(plain)) return { ok: false, items, raw: plain.slice(0, 200) };
  return { ok: true, items };
}

/** Move MPC/SkyBoT objects from their own time to another time (hours later) along their reported motion. */
function shiftItems(items, hours) {
  return items.map(o => {
    const c = Math.max(0.05, Math.cos(o.dec * Math.PI / 180));
    return Object.assign({}, o, { ra: o.ra + o.dra * hours / 3600 / c, dec: o.dec + o.ddec * hours / 3600 });
  });
}

/** Horizons observer table (CSV_FORMAT=YES, ANG_FORMAT=DEG) -> [{t,ra,dec,mag}] */
function parseHorizons(result) {
  const a = result.indexOf('$$SOE'), b = result.indexOf('$$EOE');
  if (a < 0 || b < 0) return [];
  const out = [];
  for (const line of result.slice(a + 5, b).split('\n')) {
    const f = line.split(',').map(s => s.trim());
    if (f.length < 4 || !f[0]) continue;
    const nums = f.slice(1).filter(x => x !== '' && /^[+-]?\d+(\.\d+)?$/.test(x)).map(Number);
    if (nums.length < 2) continue;
    out.push({ t: f[0], ra: nums[0], dec: nums[1], mag: nums[2] ?? null });
  }
  return out;
}

module.exports = { parseCSV, normaliseSpherex, parseSesame, parseSexa, parseSkybot, parseMpc, shiftItems, parseHorizons };
