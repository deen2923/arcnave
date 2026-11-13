'use strict';
// ARCNAVE backend: static files + a small CORS-free proxy for IRSA (SPHEREx), CDS Sesame,
// IMCCE SkyBoT and JPL Horizons. Zero dependencies, needs Node 18+.
//
// Speed (v0.4): a SPHEREx cutout from IRSA is ~6.4 MB, of which ~4.9 MB is a PSF cube the app never uses. The server keeps
// only IMAGE, FLAGS, ZODI and WCS-WAVE (~1.1 MB) and gzips it (~0.6 MB): about 11x less to the browser. Results are also
// kept on disk (cache/), so a field loads instantly the second time and still works when IRSA or the internet is down
// (offline demo). Identical requests in flight share one download.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const P = require('./lib/parsers');
const FITS = require('./lib/fits');
const S3CUT = require('./lib/s3cut');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const UA = 'ARCNAVE/0.4 (educational sky viewer)';
const CACHE_DIR = process.env.SKYSHIFT_CACHE_DIR || path.join(ROOT, 'cache');
const CACHE_MB = +process.env.SKYSHIFT_CACHE_MB || 8000;      // disk cache limit; oldest files are removed beyond it (v0.56: 2000 → 8000, so fields opened before stay)
const MAX_UPSTREAM = +process.env.SKYSHIFT_UPSTREAM || 8;     // parallel downloads from IRSA and the other services
const SEED_DIR = process.env.SKYSHIFT_SEED_DIR || path.join(ROOT, 'demo-cache');   // real results shipped with the site (examples open instantly)
const KEEP_HDUS = new Set(['PRIMARY', 'IMAGE', 'FLAGS', 'ZODI', 'WCS-WAVE']);
const LOG = require.main === module || process.env.SKYSHIFT_LOG === '1';   // speed log in the terminal when run directly

/* ---------- memory cache, concurrency limit, upstream fetch ---------- */
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = fn().catch(e => { cache.delete(key); throw e; });
  cache.set(key, { exp: Date.now() + ttlMs, p });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return p;
}
let active = 0; const waiting = [];
async function limited(fn) {
  while (active >= MAX_UPSTREAM) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
// IRSA answers "503 Server busy" when it gets many cutout requests at once (seen live: 17 of 24 failed with 8 in parallel,
// each worked when asked again). So: at most IRSA_PARALLEL cutout downloads at a time, and busy/timeout answers are retried
// a few times with growing pauses (the concurrency slot is free while waiting).
const RETRIES = process.env.SKYSHIFT_RETRIES != null ? +process.env.SKYSHIFT_RETRIES : 3;
const RETRY_MS = +process.env.SKYSHIFT_RETRY_MS || 2500;
const IRSA_PARALLEL = +process.env.SKYSHIFT_IRSA_PARALLEL || 4;
const retryable = e => [408, 429, 500, 502, 503, 504].includes(e.status) || e.name === 'AbortError' || /fetch failed|ECONNRESET|socket|terminated|timeout/i.test(e.message || '');
async function upstream(url, opts = {}) {
  const tries = opts.retries != null ? opts.retries : RETRIES;
  for (let k = 0; ; k++) {
    try { return await upstreamOnce(url, opts); }
    catch (e) {
      if (k >= tries || !retryable(e)) throw e;
      stats.retries = (stats.retries || 0) + 1;
      if (LOG) console.log(`  upstream busy or slow (${String(e.status || e.name || '')} ${String(e.message || '').slice(0, 50)}), retry ${k + 1} of ${tries}...`);
      await new Promise(r => setTimeout(r, Math.min(20000, RETRY_MS * 2 ** k) + Math.random() * RETRY_MS * 0.4));
    }
  }
}
let irsaActive = 0; const irsaWaiting = [];
async function irsaLimited(fn) {
  while (irsaActive >= IRSA_PARALLEL) await new Promise(r => irsaWaiting.push(r));
  irsaActive++;
  try { return await fn(); } finally { irsaActive--; irsaWaiting.shift()?.(); }
}
async function upstreamOnce(url, opts = {}) {
  return (opts.lim || limited)(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), opts.timeout || 60000);
    try {
      const r = await fetch(url, { method: opts.body ? 'POST' : 'GET', body: opts.body, headers: Object.assign({ 'User-Agent': UA }, opts.headers), signal: ctl.signal });
      if (!r.ok) { const body = (await r.text()).slice(0, 300); const e = new Error(`Upstream ${r.status}: ${body}`); e.status = r.status; throw e; }
      // read the body inside the timeout and the concurrency slot
      return opts.binary ? Buffer.from(await r.arrayBuffer()) : opts.json ? await r.json() : await r.text();
    } finally { clearTimeout(t); }
  });
}

/* ---------- disk cache (also the offline fallback) ---------- */
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const stats = { memHits: 0, diskHits: 0, staleServed: 0, downloads: 0, bytesFromIrsa: 0, bytesToBrowser: 0 };
// v0.26: a cache hit refreshes the file's time, so 'recently used' really means used (prune keeps it, and
// tools/export-demo-cache.js --newer-than picks up files a prewarm run read from cache, not only the ones it downloaded)
async function diskRead(file) { try { const b = await fs.promises.readFile(file); const t = new Date(); fs.promises.utimes(file, t, t).catch(() => {}); return b; } catch { return null; } }
async function diskWrite(file, data) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, file);
    if (++writes % 25 === 0) prune().catch(() => {});
  } catch { /* a read-only disk only costs speed */ }
}
let writes = 0;
async function prune() {
  const files = [];
  for (const sub of ['cutouts', 'api', ...Object.keys(HIPS).map(k => 'hips/' + k)]) {   // v0.21: sky tiles count too
    const dir = path.join(CACHE_DIR, sub);
    let names = []; try { names = await fs.promises.readdir(dir); } catch { continue; }
    // never evict the shipped example files: seen live after the 18-field scorecard filled the cache past the limit,
    // the examples (and the guided tour on them) silently went back to downloading from IRSA
    let seeded = new Set(); try { seeded = new Set(await fs.promises.readdir(path.join(SEED_DIR, sub))); } catch { /* no seed folder */ }
    // v0.56: the start screen's fields, prewarmed and pinned by tools/pin-cache.js (cache/pinned.json), are kept the same way
    try { const pin = JSON.parse(await fs.promises.readFile(path.join(CACHE_DIR, 'pinned.json'), 'utf8')); for (const nm of pin[sub] || []) seeded.add(nm); } catch { /* nothing pinned */ }
    for (const n of names) { if (seeded.has(n)) continue; try { const s = await fs.promises.stat(path.join(dir, n)); files.push({ f: path.join(dir, n), size: s.size, t: s.mtimeMs }); } catch { /* gone */ } }
  }
  let total = files.reduce((a, x) => a + x.size, 0);
  files.sort((a, b) => a.t - b.t);
  for (const x of files) { if (total <= CACHE_MB * 1e6) break; try { await fs.promises.unlink(x.f); total -= x.size; } catch { /* ignore */ } }
}
async function cacheInfo() {
  let n = 0, bytes = 0;
  for (const sub of ['cutouts', 'api']) {
    let names = []; try { names = await fs.promises.readdir(path.join(CACHE_DIR, sub)); } catch { continue; }
    for (const nm of names) { try { bytes += (await fs.promises.stat(path.join(CACHE_DIR, sub, nm))).size; n++; } catch { /* gone */ } }
  }
  return { files: n, mb: +(bytes / 1e6).toFixed(1), limitMb: CACHE_MB };
}
// JSON results: fresh from disk if younger than ttl; otherwise ask upstream; if upstream fails, serve the old copy
// (marked stale) so a demo keeps working offline.
// v0.55 U7: fresh = ask upstream now, past both caches (the "Check for new data" button); the answer replaces the cached one
const REVALIDATING = new Set(), SWR_OFF = process.env.SKYSHIFT_SWR === '0';
// v0.56.3: the image lists of the start screen's fields (pinned by tools/pin-cache.js) and of the shipped examples are FROZEN:
// never asked again in the background, never replaced. NASA's DR1 (Nov 2026) re-lists every image under new file names, so a
// refreshed list would make each of those fields download ~100 MB again, and ARCNAVE's quoted numbers were measured on these
// lists (QR2 + QR3). "Check for new data" still shows the archive's list now, and ?latest=1 keeps its own list (kind searchl).
let FROZEN = { at: 0, set: new Set() };
async function frozenSet() {
  if (Date.now() - FROZEN.at < 60e3) return FROZEN.set;
  const set = new Set();
  try { for (const n of JSON.parse(await fs.promises.readFile(path.join(CACHE_DIR, 'pinned.json'), 'utf8')).api || []) set.add(n); } catch { /* nothing pinned */ }
  try { for (const n of await fs.promises.readdir(path.join(SEED_DIR, 'api'))) set.add(n); } catch { /* no seed folder */ }
  FROZEN = { at: Date.now(), set }; return set;
}
function cachedJSON(kind, key, ttlMs, fn, fresh = false) {
  const run = async () => {
    const file = path.join(CACHE_DIR, 'api', kind + '-' + hash(key) + '.json');
    const old = await diskRead(file);
    let saved = null; try { saved = old && JSON.parse(old.toString('utf8')); } catch { saved = null; }
    const frozen = kind === 'search' && saved && (await frozenSet()).has(path.basename(file));
    if (frozen && !fresh) { stats.diskHits++; stats.frozenHits = (stats.frozenHits || 0) + 1; return Object.assign({}, saved.data, { frozen: true }); }
    if (frozen && fresh) return Object.assign({}, await fn(), { frozen: true, frozenKept: true });   // shown, not saved over the frozen list
    if (!fresh && saved && Date.now() - saved.savedAt < ttlMs) { stats.diskHits++; return saved.data; }
    // v0.56: an answer past its time is still served at once (a field opened before must not wait 6-16 s for IRSA again
    // after a day), and asked for again in the background; the next visit gets the new one. "Check for new data" (fresh)
    // still waits for the archive.
    if (!fresh && saved && !SWR_OFF) {
      stats.staleRevalidate = (stats.staleRevalidate || 0) + 1;
      if (!REVALIDATING.has(file)) { REVALIDATING.add(file);
        fn().then(data => diskWrite(file, JSON.stringify({ savedAt: Date.now(), key, data }))).catch(() => { /* keep the old one */ }).finally(() => REVALIDATING.delete(file)); }
      return saved.data;
    }
    try {
      const data = await fn();
      await diskWrite(file, JSON.stringify({ savedAt: Date.now(), key, data }));
      return data;
    } catch (e) {
      if (saved && !(e.status === 400 || e.status === 404)) { stats.staleServed++; return Object.assign({}, saved.data, { stale: true, savedAt: new Date(saved.savedAt).toISOString() }); }
      throw e;
    }
  };
  if (!fresh) return cached(kind + ':' + key, Math.min(ttlMs, 3600e3), run);
  const p = run().catch(e => { cache.delete(kind + ':' + key); throw e; });
  cache.set(kind + ':' + key, { exp: Date.now() + Math.min(ttlMs, 3600e3), p });
  // v0.56.3: a frozen list's fresh check is shown once, never kept in memory in place of the frozen list (seen live: the
  // next ordinary visit got the new list for an hour)
  p.then(d => { if (d && d.frozenKept && cache.get(kind + ':' + key)?.p === p) cache.delete(kind + ':' + key); }, () => {});
  return p;
}

// Copy the shipped demo results into the cache folder (only files that are not there yet). JSON answers get a fresh date, so
// they count as current. A host with an empty disk therefore still opens the examples at once, even when IRSA is busy.
function seedCache() {
  let n = 0;
  for (const sub of ['cutouts', 'api']) {
    let names = []; try { names = fs.readdirSync(path.join(SEED_DIR, sub)); } catch { continue; }
    try { fs.mkdirSync(path.join(CACHE_DIR, sub), { recursive: true }); } catch { continue; }
    for (const nm of names) {
      const to = path.join(CACHE_DIR, sub, nm); if (fs.existsSync(to)) continue;
      try {
        const from = path.join(SEED_DIR, sub, nm);
        if (sub === 'api') { const j = JSON.parse(fs.readFileSync(from, 'utf8')); j.savedAt = Date.now(); fs.writeFileSync(to, JSON.stringify(j)); }
        else fs.copyFileSync(from, to);
        n++;
      } catch { /* a read-only disk only costs speed */ }
    }
  }
  return n;
}

/* ---------- API handlers ---------- */
const num = (v, lo, hi, name) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x < lo || x > hi) { const e = new Error(`Bad parameter: ${name}`); e.status = 400; throw e; }
  return x;
};
const DAY = 864e5;

// v0.21: CDS Sesame (France) first; NASA/IPAC NED as the fallback. Seen live: every French server (CDS, IMCCE) became
// unreachable from the user's network, so "Fly to M42" hung. Sesame gets 8 s and is skipped for 5 minutes after a failure.
const SESAME = { downUntil: 0 };
function parseNed(j) {
  const pos = j && j.ResultCode === 3 && j.Preferred && j.Preferred.Position;
  return pos && Number.isFinite(pos.RA) && Number.isFinite(pos.Dec) ? { ra: pos.RA, dec: pos.Dec, name: j.Preferred.Name || null, source: 'NED' } : null;
}
async function resolve(q) {
  const name = String(q.q || '').trim();
  if (!name || name.length > 100) { const e = new Error('Missing name'); e.status = 400; throw e; }
  return cachedJSON('resolve', name.toLowerCase(), 30 * DAY, async () => {
    let hit = null;
    if (Date.now() >= SESAME.downUntil) {
      try { hit = P.parseSesame(await upstream('https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?' + encodeURIComponent(name), { timeout: 8000, retries: 0 })); }
      catch (e) { if (!e.status || e.status >= 500) SESAME.downUntil = Date.now() + 300000; }
    }
    if (!hit) {
      try {
        const j = await upstream('https://ned.ipac.caltech.edu/srs/ObjectLookup', { method: 'POST', body: 'json=' + encodeURIComponent(JSON.stringify({ name: { v: name } })),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, retries: 1, json: true });
        hit = parseNed(j);
      } catch (e) { if (LOG) console.log('  NED name lookup failed: ' + String(e.message).slice(0, 80)); }
    }
    if (!hit) { const e = new Error('Name not found'); e.status = 404; throw e; }
    return hit;
  });
}

/* ---------- base sky tiles (v0.21) ---------- */
// The background sky (HiPS tiles of 2MASS, AllWISE, DSS2) normally comes from CDS in Strasbourg. Seen live: CDS was
// unreachable from the user's network and the page showed no sky at all. The page now asks this server (/hips/<sky>/...),
// which takes each tile from the first mirror that answers: NASA/IPAC IRSA, then CSIRO CASDA (Australia), China-VO, CDS.
// Same tiles everywhere (mirrors of the CDS HiPS); kept on disk, so a sky seen once (and the demo) works offline.
const HIPS = {
  '2mass': ['https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color', 'https://casda.csiro.au/hips/2MASS/Color', 'https://hips.china-vo.org/m/CDS_P_2MASS_color', 'https://alasky.cds.unistra.fr/2MASS/Color', 'https://alasky.u-strasbg.fr/2MASS/Color'],
  'allwise': ['https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1', 'https://hips.china-vo.org/m/CDS_P_allWISE_color', 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1', 'https://alasky.u-strasbg.fr/AllWISE/RGB-W4-W2-W1'],
  'dss2': ['https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', 'https://hips.china-vo.org/m/CDS_P_DSS2_color', 'https://alasky.cds.unistra.fr/DSS/DSSColor', 'https://alasky.u-strasbg.fr/DSS/DSSColor'],
};
const HIPS_BAD = new Map();   // mirror -> time until which it is skipped (failed recently)
const hipsLimited = (() => { let act = 0; const wait = []; return async fn => { while (act >= 12) await new Promise(r => wait.push(r)); act++; try { return await fn(); } finally { act--; wait.shift()?.(); } }; })();
async function hipsTile(req, res, pathname) {
  const m = /^\/hips\/([a-z0-9]+)\/((?:properties|Moc\.fits|Norder\d{1,2}\/Allsky\.(?:jpg|png)|Norder\d{1,2}\/Dir\d{1,7}\/Npix\d{1,10}\.(?:jpg|png)))$/.exec(pathname);
  if (!m || !HIPS[m[1]]) { const e = new Error('Not a sky tile'); e.status = 404; throw e; }
  const [, sky, rel] = m, file = path.join(CACHE_DIR, 'hips', sky, rel.replace(/\//g, '_'));
  const type = rel === 'properties' ? 'text/plain; charset=utf-8' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.fits') ? 'application/fits' : 'image/jpeg';
  let body = await diskRead(file), from = 'disk';
  if (!body) {
    from = null;
    for (const base of HIPS[sky]) {
      if ((HIPS_BAD.get(base) || 0) > Date.now()) continue;
      try {
        body = await hipsLimited(() => upstream(base + '/' + rel, { timeout: 12000, retries: 0, binary: true, lim: f => f() }));
        if (rel === 'properties' ? !/hips_/.test(body.toString('latin1', 0, 4000)) : body.length < 100) throw Object.assign(new Error('not a HiPS file'), { status: 502 });
        from = new URL(base).hostname; break;
      } catch (e) {
        body = null;
        if (e.status === 404) { if (rel === 'properties') HIPS_BAD.set(base, Date.now() + 3600000); else break; }   // a missing tile is missing everywhere (empty sky)
        else HIPS_BAD.set(base, Date.now() + 120000);   // unreachable: try the next mirror, come back in 2 minutes
      }
    }
    if (!body) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
    stats.hipsTiles = (stats.hipsTiles || 0) + 1;
    await diskWrite(file, body);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*', 'X-Arcnave-From': from });
  res.end(body);
}

const SEARCHES = []; // last few archive searches, for the debug bundle
const FRESH = new Map();   // v0.55 U7: when each spot was last re-asked with fresh=1 (at most once a minute per spot)
async function spherexSearch(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), key = `${ra.toFixed(3)},${dec.toFixed(3)}`;
  let fresh = q.fresh === '1' && !(Date.now() - (FRESH.get(key) || 0) < 60e3);
  if (fresh) { FRESH.set(key, Date.now()); if (FRESH.size > 500) FRESH.delete(FRESH.keys().next().value); }
  // Archive lists change only when IRSA adds a data release: one day is fresh enough.
  // v0.56.3: latest=1 = the archive's list now, kept apart from a frozen list (see frozenSet)
  return cachedJSON(q.latest === '1' ? 'searchl' : 'search', key, DAY, async () => {
    const adql =
      "SELECT TOP 4000 'https://irsa.ipac.caltech.edu/' || a.uri AS download_url, p.obs_publisher_did, " +
      'p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper, p.poly ' +
      'FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ' +
      `WHERE CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) = 1 ORDER BY p.time_bounds_lower`;
    const url = 'https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql);
    const images = P.normaliseSpherex(P.parseCSV(await upstream(url, { timeout: 90000 })));
    const out = { ra, dec, count: images.length, images, checkedAt: new Date().toISOString() };   // v0.55 U7: when the archive was asked
    SEARCHES.push({ at: out.checkedAt, adql, ...out }); if (SEARCHES.length > 5) SEARCHES.shift();
    return out;
  }, fresh);
}

/* ---------- catalogue brightness for spectra (v0.35) ---------- */
// 2MASS (J, H, Ks) and AllWISE (W1, W2) magnitudes of the sources within r arcsec, to check a SPHEREx spectrum against
// two other NASA surveys. NASA/IPAC IRSA TAP first (the archive the SPHEREx images come from), CDS VizieR if IRSA fails.
async function photcat(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(30, Math.max(2, +q.r || 12));
  return cachedJSON('photcat', `${ra.toFixed(5)},${dec.toFixed(5)},${r}`, 30 * DAY, async () => {
    const circ = `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${(r / 3600).toFixed(6)})) = 1`;
    const tap = a => upstream('https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(a), { timeout: 30000, retries: 1 });
    const viz = (src, cols) => upstream(`https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=${src}&-c=${ra}${dec >= 0 ? '%2B' : ''}${dec}&-c.rs=${r}&-out=${cols}&-out.max=50`, { timeout: 30000, retries: 0 });
    const tsv = t => { const L = t.split('\n').filter(l => l && !l.startsWith('#')); const i = L.findIndex(l => /^-+/.test(l)); if (i < 1) return []; const h = L[i - 1].split('\t').map(x => x.trim());
      return L.slice(i + 1).map(l => { const c = l.split('\t'); return Object.fromEntries(h.map((k, j) => [k, (c[j] || '').trim()])); }); };
    const f = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
    const out = { ra, dec, r, twomass: [], wise: [], via: {} };
    try {
      out.twomass = P.parseCSV(await tap(`SELECT ra, dec, j_m, h_m, k_m, ph_qual, cc_flg FROM fp_psc WHERE ${circ}`))
        .map(o => ({ ra: f(o.ra), dec: f(o.dec), J: f(o.j_m), H: f(o.h_m), K: f(o.k_m), q: o.ph_qual, cc: o.cc_flg })); out.via.twomass = 'IRSA';
    } catch (e) {
      try { out.twomass = tsv(await viz('II/246/out', 'RAJ2000,DEJ2000,Jmag,Hmag,Kmag,Qflg,Cflg')).map(o => ({ ra: f(o.RAJ2000), dec: f(o.DEJ2000), J: f(o.Jmag), H: f(o.Hmag), K: f(o.Kmag), q: o.Qflg, cc: o.Cflg })); out.via.twomass = 'VizieR'; }
      catch { out.via.twomass = 'unavailable'; }
    }
    try {
      out.wise = P.parseCSV(await tap(`SELECT ra, dec, w1mpro, w2mpro, ph_qual, cc_flags FROM allwise_p3as_psd WHERE ${circ}`))
        .map(o => ({ ra: f(o.ra), dec: f(o.dec), W1: f(o.w1mpro), W2: f(o.w2mpro), q: o.ph_qual, cc: o.cc_flags })); out.via.wise = 'IRSA';
    } catch (e) {
      try { out.wise = tsv(await viz('II/328/allwise', 'RAJ2000,DEJ2000,W1mag,W2mag,qph,ccf')).map(o => ({ ra: f(o.RAJ2000), dec: f(o.DEJ2000), W1: f(o.W1mag), W2: f(o.W2mag), q: o.qph, cc: o.ccf })); out.via.wise = 'VizieR'; }
      catch { out.via.wise = 'unavailable'; }
    }
    if (out.via.twomass === 'unavailable' && out.via.wise === 'unavailable') { const e = new Error('2MASS and WISE catalogues are not answering right now'); e.status = 503; throw e; }
    return out;
  });
}

/* ---------- Gaia DR3 stars for the overlay and the motion check (v0.36) ---------- */
// Positions at Gaia's epoch J2016.0, proper motions, parallaxes, G magnitudes of the brightest stars in the field.
// NASA/IPAC IRSA TAP first (gaia_dr3_source), CDS VizieR (I/355/gaiadr3) if IRSA fails. Cached 30 days.
async function gaia(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(1.2, Math.max(0.02, +q.r || 0.36)), gmax = Math.min(20, Math.max(8, +q.g || 18));
  return cachedJSON('gaia', `${ra.toFixed(4)},${dec.toFixed(4)},${r.toFixed(3)},${gmax}`, 30 * DAY, async () => {
    const f = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
    let stars = null, via = null;
    try {
      const adql = `SELECT TOP 3000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag FROM gaia_dr3_source ` +
        `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) = 1 AND phot_g_mean_mag < ${gmax} ORDER BY phot_g_mean_mag`;
      const rows = P.parseCSV(await upstream('https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql), { timeout: 60000, retries: 1 }));
      stars = rows.map(o => ({ id: o.source_id, ra: f(o.ra), dec: f(o.dec), plx: f(o.parallax), pmra: f(o.pmra), pmdec: f(o.pmdec), g: f(o.phot_g_mean_mag) })); via = 'IRSA';
    } catch (e) {
      const t = await upstream(`https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/355/gaiadr3&-c=${ra}${dec >= 0 ? '%2B' : ''}${dec}&-c.rd=${r}&-out=Source,RA_ICRS,DE_ICRS,Plx,pmRA,pmDE,Gmag&Gmag=%3C${gmax}&-sort=Gmag&-out.max=3000`, { timeout: 60000, retries: 0 });
      const L = t.split('\n').filter(l => l && !l.startsWith('#')), i = L.findIndex(l => /^-+/.test(l));
      const h = i > 0 ? L[i - 1].split('\t').map(x => x.trim()) : [];
      stars = (i > 0 ? L.slice(i + 1) : []).map(l => { const c = l.split('\t'), o = Object.fromEntries(h.map((k, j) => [k, (c[j] || '').trim()]));
        return { id: o.Source, ra: f(o.RA_ICRS), dec: f(o.DE_ICRS), plx: f(o.Plx), pmra: f(o.pmRA), pmdec: f(o.pmDE), g: f(o.Gmag) }; }); via = 'VizieR';
    }
    return { ra, dec, r, gmax, epoch: 2016.0, via, stars: stars.filter(s => s.ra != null && s.dec != null) };
  });
}

/* ---------- CatWISE2020 sources for the WISE overlay and the mover labels (v0.53, rank 7 of the research report) ----------
   Gaia cannot see cold brown dwarfs (WISE 0855 is missing from it); CatWISE2020 measured motions from WISE's 2010-2018
   images for sources down to W1 ~17. Positions are for MJD 57170 (2015.4); pmra already includes cos(dec), in arcsec/yr.
   NASA/IPAC IRSA TAP (catwise_2020) only: CDS VizieR (II/365) could not be reached from the team's network to check its
   columns, so there is no untested fallback. Sent compact (one array per source), cached 30 days. */
async function catwise(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(0.8, Math.max(0.02, +q.r || 0.36));
  return cachedJSON('catwise', `${ra.toFixed(4)},${dec.toFixed(4)},${r.toFixed(3)}`, 30 * DAY, async () => {
    const adql = 'SELECT TOP 40000 source_name, ra_pm, dec_pm, pmra, pmdec, sigpmra, sigpmdec, w1mpro, w2mpro, w2snr, nb, ab_flags FROM catwise_2020 ' +
      `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) = 1 AND w2snr > 5`;
    const rows = P.parseCSV(await upstream('https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql), { timeout: 90000, retries: 1 }));
    const f = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? +x.toFixed(d) : null; };
    const src = rows.map(o => [o.source_name, f(o.ra_pm, 7), f(o.dec_pm, 7), f(o.pmra, 4), f(o.pmdec, 4), f(o.sigpmra, 4), f(o.sigpmdec, 4), f(o.w1mpro, 3), f(o.w2mpro, 3), f(o.w2snr, 1), +o.nb || 0, o.ab_flags || ''])
      .filter(s => s[1] != null && s[2] != null);
    return { ra, dec, r, epochMjd: 57170, via: 'IRSA', cols: ['name', 'ra', 'dec', 'pmra', 'pmdec', 'spmra', 'spmdec', 'w1', 'w2', 'snr', 'nb', 'ab'], src };
  });
}

/** Keep only the extensions the app reads. Header and data blocks are copied byte for byte (FITS stays valid). */
function stripFits(buf) {
  let hdus;
  try { hdus = FITS.parseFITS(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); } catch { return buf; }
  const parts = []; let start = 0;
  hdus.forEach((h, i) => {
    const end = h.dataStart + Math.ceil(h.dataLen / 2880) * 2880;
    const name = i === 0 ? 'PRIMARY' : String(h.header.EXTNAME || '').trim().toUpperCase();
    if (KEEP_HDUS.has(name)) parts.push(buf.subarray(start, Math.min(end, buf.length)));
    start = end;
  });
  return parts.length ? Buffer.concat(parts) : buf;
}

const CUTOUT = new Map();    // url -> gzipped stripped FITS (memory LRU)
const INFLIGHT = new Map();  // url -> Promise, so parallel requests for one cutout share one download
async function getCutout(key) {
  const m = CUTOUT.get(key);
  if (m) { stats.memHits++; CUTOUT.delete(key); CUTOUT.set(key, m); return { gz: m, from: 'memory' }; }
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    const file = path.join(CACHE_DIR, 'cutouts', hash(key) + '.fits.gz');
    let gz = await diskRead(file), from = 'disk';
    if (gz) { stats.diskHits++; if (LOG) console.log('  cutout from disk cache (instant)'); }
    else {
      const t0 = Date.now();
      let raw = null;
      // v0.17: NASA's open-data copy on AWS first (a few seconds), IRSA's cutout service if that fails (25-45 s)
      try { raw = await s3Cutout(key); from = 's3'; }
      catch (e) { if (e.s3) { stats.s3Fail = (stats.s3Fail || 0) + 1; if (LOG) console.log('  S3 copy not usable (' + String(e.message).slice(0, 80) + '), asking IRSA'); } }
      if (!raw) {
        raw = await irsaLimited(() => upstream(key, { timeout: 180000, binary: true }));
        stats.downloads++; stats.bytesFromIrsa += raw.length; from = 'irsa';
      }
      gz = zlib.gzipSync(stripFits(raw), { level: 1 });
      if (LOG) console.log(`  cutout from ${from === 's3' ? 'NASA S3 copy' : 'IRSA'}: ${(raw.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${(gz.length / 1e6).toFixed(2)} MB to the browser`);
      await diskWrite(file, gz);
    }
    CUTOUT.set(key, gz);
    while (CUTOUT.size > 200) CUTOUT.delete(CUTOUT.keys().next().value);
    return { gz, from };
  })().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}
// v0.17: cutouts read straight from NASA's open-data copy of SPHEREx on AWS S3 (lib/s3cut.js): only the rows of the field
// are downloaded (about 7.5 MB, a few seconds) instead of waiting 25-45 s for IRSA's cutout service. Checked live against
// IRSA's own cutouts of the same images: every IMAGE, FLAGS and ZODI pixel identical, headers identical except the size
// and reference pixels. v0.17.1: the page does this itself (public/app.js loadViaS3); the server-side path is off unless
// SKYSHIFT_S3=1 (on the user's PC Node's requests to S3 hung while the browser's worked).
const S3 = { active: 0, waiting: [], max: +process.env.SKYSHIFT_S3_PARALLEL || 6, hint: null, timeout: 45000 };
async function s3Limited(fn) {
  while (S3.active >= S3.max) await new Promise(r => S3.waiting.push(r));
  S3.active++;
  try { return await fn(); } finally { S3.active--; S3.waiting.shift()?.(); }
}
async function s3Get(url, a, b) {
  for (let k = 0; ; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), S3.timeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` }, signal: ctl.signal });
      if (r.status !== 206 && r.status !== 200) { const e = new Error('S3 HTTP ' + r.status); e.status = r.status; throw e; }
      const buf = new Uint8Array(await r.arrayBuffer()), cr = r.headers.get('content-range');
      stats.bytesFromS3 = (stats.bytesFromS3 || 0) + buf.length;
      return { buf, total: cr && /\/(\d+)$/.test(cr) ? +cr.split('/')[1] : null };
    } catch (e) {
      if (k >= 1 || e.status === 403 || e.status === 404 || e.status === 416) throw e;
      await new Promise(r => setTimeout(r, 500));
    } finally { clearTimeout(t); }
  }
}
async function s3Cutout(key) {
  if (process.env.SKYSHIFT_S3 !== '1') throw new Error('off');   // live: hung from the user's PC while the browser read S3 fine, so off unless asked for
  const u = new URL(key), s3 = S3CUT.s3Url(u.origin + u.pathname);
  if (!s3) throw new Error('not an S3 file');
  const [ra, dec] = String(u.searchParams.get('center')).split(',').map(Number), size = +u.searchParams.get('size');
  try {
    const c = await s3Limited(() => S3CUT.cutout((a, b) => s3Get(s3, a, b), ra, dec, size, S3.hint, { zodiRows: 9 }));   // v0.56: ZODI from 9 rows (lib/s3cut.js)
    S3.hint = c.offsets; stats.s3Cutouts = (stats.s3Cutouts || 0) + 1;
    return Buffer.from(c.fits.buffer, c.fits.byteOffset, c.fits.length);
  } catch (e) { e.s3 = true; stats.s3LastError = String(e.message || e).slice(0, 160); throw e; }
}
function cutoutUrl(q) {
  let u;
  try { u = new URL(String(q.url)); } catch { const e = new Error('Bad url'); e.status = 400; throw e; }
  // Only IRSA image paths: this must never become an open proxy.
  if (u.protocol !== 'https:' || u.hostname !== 'irsa.ipac.caltech.edu' || !u.pathname.startsWith('/ibe/') || u.search) {
    const e = new Error('URL not allowed'); e.status = 400; throw e;
  }
  let ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), size = num(q.size, 0.01, 1.0, 'size');
  // Round so -4.182 and -4.182000000000001 share one cache entry and one download (Cowork review found duplicates). 1e-5 deg = 0.036 arcsec.
  ra = +ra.toFixed(5); dec = +dec.toFixed(5); size = +size.toFixed(4);
  u.search = `?center=${ra},${dec}&size=${size}`;
  return { u, ra, dec, size };
}
// v0.17.1: the page reads new images itself from NASA's S3 copy (browser fetch works where this server's did not, seen live),
// so it first asks "cached=1": the cutout if this server has it (examples, spots opened before), else 204 without downloading.
async function cachedCutout(key) {
  const m = CUTOUT.get(key); if (m) return { gz: m, from: 'memory' };
  const gz = await diskRead(path.join(CACHE_DIR, 'cutouts', hash(key) + '.fits.gz'));
  if (gz) { CUTOUT.set(key, gz); return { gz, from: 'disk' }; }
  return null;
}
// ...and hands a cutout it read from S3 back here, so the spot opens from the cache next time. Local runs only: on a public
// host one visitor must not be able to put files into the cache that others are served.
async function cutoutPut(req, q) {
  if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) { const e = new Error('Only on a local run'); e.status = 404; throw e; }
  const { u } = cutoutUrl(q), key = u.toString(), body = await readBodyBuf(req, 12e6);
  let hd; try { hd = FITS.parseFITS(body.buffer.slice(body.byteOffset, body.byteOffset + body.length)); } catch { hd = null; }
  const hi = hd && FITS.findHDU(hd, 'IMAGE');
  if (!hi || !(hi.header.NAXIS1 > 0 && hi.header.NAXIS1 <= 2040 && hi.header.NAXIS2 > 0 && hi.header.NAXIS2 <= 2040) || !FITS.findHDU(hd, 'FLAGS')) { const e = new Error('Not a SPHEREx cutout'); e.status = 400; throw e; }
  if (await cachedCutout(key)) return { saved: false };
  const gz = zlib.gzipSync(stripFits(body), { level: 1 });
  CUTOUT.set(key, gz); stats.s3Cutouts = (stats.s3Cutouts || 0) + 1;
  await diskWrite(path.join(CACHE_DIR, 'cutouts', hash(key) + '.fits.gz'), gz);
  return { saved: true };
}
function readBodyBuf(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const parts = [];
    req.on('data', d => { n += d.length; if (n > max) { const e = new Error('Body too large'); e.status = 400; rej(e); req.destroy(); } else parts.push(d); });
    req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej);
  });
}
async function spherexCutout(q, req, res) {
  const { u } = cutoutUrl(q);
  if (q.cached === '1') {
    const c = await cachedCutout(u.toString());
    if (!c) { res.writeHead(204, { 'Cache-Control': 'no-store', 'X-Arcnave-Put': (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) ? '0' : '1',
      // v0.38: on a host in a data centre the server reads S3 far faster than a visitor's phone, and sends a stripped, gzipped
      // cutout (~0.5 MB instead of the ~7.5 MB of rows the page would read itself), shared by every later visitor
      'X-Arcnave-Server-S3': process.env.SKYSHIFT_S3 === '1' ? '1' : '0' }); return res.end(); }
  }
  const t0 = Date.now(), { gz, from } = await getCutout(u.toString());
  const gzipOk = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = gzipOk ? gz : zlib.gunzipSync(gz);
  stats.bytesToBrowser += body.length;
  res.writeHead(200, { 'Content-Type': 'application/fits', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400',
    'Vary': 'Accept-Encoding', 'X-Arcnave-Cache': from, 'Server-Timing': `cutout;desc="${from}";dur=${Date.now() - t0}`,
    ...(gzipOk ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(body);
}

// The official SPHEREx PSF for the spot (ra, dec) of one image: the image's own "PSF" extension (11 x 11 detector zones,
// each 101 x 101 at 10x oversampling, built by the pipeline from >1000 stars per zone; Akeson et al. 2025, SPHEREx pipeline
// paper). Zone = the one containing the spot's detector position, plane = y * 11 + x (IRSA "PSF extension header error"
// note: QR files before pipeline 6.5.6 had the header's zone order wrong; the cube order itself is right). A tiny cutout
// (0.02 deg) is downloaded once; the cube comes with it. Used by /dev/psfcheck.html to test ARCNAVE's own PSF.
function readPsfZone(raw, ra, dec) {
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), hd = FITS.parseFITS(ab);
  const hi = FITS.findHDU(hd, 'IMAGE'), hp = FITS.findHDU(hd, 'PSF');
  if (!hi || !hp) { const e = new Error('No PSF extension in this file'); e.status = 404; throw e; }
  const h = hp.header, nx = h.NAXIS1, ny = h.NAXIS2, nz = h.NAXIS3 || 1, os = h.OVERSAMP || 10;
  const p = FITS.sky2pix(FITS.makeWCS(hi.header), ra, dec), H = hi.header;
  const det = { x: (H.CRVAL1A || 0) + (H.CDELT1A || 1) * (p[0] - H.CRPIX1A), y: (H.CRVAL2A || 0) + (H.CDELT2A || 1) * (p[1] - H.CRPIX2A) };  // 0-based detector pixel
  const ng = Math.round(Math.sqrt(nz)), zw = 2040 / ng, zx = Math.max(0, Math.min(ng - 1, Math.floor(det.x / zw))), zy = Math.max(0, Math.min(ng - 1, Math.floor(det.y / zw)));
  const plane = nz > 1 ? zy * ng + zx : 0;
  // what the header keywords would pick (nearest XCTR_i/YCTR_i, 1-based), for comparison only
  let hz = null, hd2 = Infinity;
  for (let i = 1; i <= nz; i++) { const X = h['XCTR_' + i], Y = h['YCTR_' + i]; if (typeof X !== 'number') continue; const d = Math.hypot(X - 1 - det.x, Y - 1 - det.y); if (d < hd2) { hd2 = d; hz = i - 1; } }
  const dv = new DataView(ab, hp.dataStart + plane * nx * ny * 4, nx * ny * 4), bp = h.BITPIX, data = new Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) data[k] = bp === -32 ? +dv.getFloat32(k * 4, false).toPrecision(6) : NaN;
  const version = String(H.VERSION || (hd[0] && hd[0].header.VERSION) || '').trim();
  return { version, oversamp: os, nx, ny, nz, det: { x: +det.x.toFixed(2), y: +det.y.toFixed(2) }, zone: { x: zx, y: zy, plane }, headerPlane: hz,
           psfFwhmHeader: H.PSF_FWHM ?? null, detector: H.DETECTOR ?? null, data };
}
async function spherexPsf(q) {
  const { u, ra, dec } = cutoutUrl(Object.assign({}, q, { size: 0.02 }));
  return cachedJSON('psf', u.toString(), 365 * DAY, async () => {
    const raw = await irsaLimited(() => upstream(u.toString(), { timeout: 180000, binary: true }));
    stats.downloads++; stats.bytesFromIrsa += raw.length;
    return readPsfZone(raw, ra, dec);
  });
}

// v0.15.3: SkyBoT has its own small pool, a shorter timeout and a breaker. Seen live: SkyBoT did not answer from the user's
// network; each of 24 lookups waited about 60 s (timeouts and retries) inside the shared download slots, so the Analyst sat
// for minutes and the IRSA images queued behind it. Now the first failure opens the breaker for 2 minutes: other lookups
// fail at once (or get an earlier saved answer) and the run finishes, saying the known-object check was not possible.
// v0.44: measured from the team's network (5 Nov 2026), SkyBoT answers correctly but in 4.6-10.1 s per field. With a 5 s
// hedge and 4 at a time, the MPC checker won almost every lookup and SkyBoT looked "not working": the queued lookups'
// 5 s ran out while they were still waiting for a slot. Now 6 at a time, a 12 s hedge, a 30 s timeout, and a gentler
// breaker (1 minute first). All still set by SKYSHIFT_SKYBOT_* environment variables.
const SKYBOT = { active: 0, waiting: [], max: +process.env.SKYSHIFT_SKYBOT_MAX || 6, downUntil: 0, fails: 0, timeout: +process.env.SKYSHIFT_SKYBOT_TIMEOUT_MS || 30000, hedgeMs: +process.env.SKYSHIFT_SKYBOT_HEDGE_MS || 12000 };
// The pause grows (1, 3, 10, 20 minutes) while SkyBoT keeps failing, so a run does not wait one more timeout every minute.
function skybotTrip() { const pause = [60, 180, 600, 1200][Math.min(SKYBOT.fails, 3)] * 1000; SKYBOT.fails++; SKYBOT.downUntil = Math.max(SKYBOT.downUntil, Date.now() + pause); }
async function skybotLimited(fn) {
  while (SKYBOT.active >= SKYBOT.max) await new Promise(r => SKYBOT.waiting.push(r));
  SKYBOT.active++;
  // queued while it went down: give up now
  try { if (Date.now() < SKYBOT.downUntil) throw skybotDown(); return await fn(); }
  catch (e) { if ((!e.status || e.status >= 500) && Date.now() >= SKYBOT.downUntil) skybotTrip(); throw e; }   // before the next one in line starts
  finally { SKYBOT.active--; SKYBOT.waiting.shift()?.(); }
}
function skybotDown() { const e = new Error('SkyBoT (the known-object service) is not answering right now. Try again in a few minutes.'); e.status = 503; return e; }

// v0.16.0: when SkyBoT (IMCCE, France) cannot be reached, ask the Minor Planet Center's MPChecker instead (same orbits, a
// different service on another network; seen live: IMCCE unreachable from the user's network, the MPC fine). It prints
// positions to 0.1 s / 1" and motions to 1"/h and gives no class, distances or position errors, so results carry source
// "MPC" and the page says so. It is "not intended for checking large numbers of fields" (CPU limit per request): one query
// at a time, answers kept 30 days, and one query serves every image within 1 hour of it (objects are moved along their
// motion: error under 0.5" for the 1"/h rounding).
const MPC = { active: 0, waiting: [], max: 2, downUntil: 0, recent: [], timeout: +process.env.SKYSHIFT_MPC_TIMEOUT_MS || 45000, share: 1 / 24 };
async function mpcLimited(fn) {
  while (MPC.active >= MPC.max) await new Promise(r => MPC.waiting.push(r));
  MPC.active++;
  try { if (Date.now() < MPC.downUntil) throw mpcDown(); return await fn(); }
  catch (e) { if ((!e.status || e.status >= 500) && Date.now() >= MPC.downUntil) MPC.downUntil = Date.now() + 120000; throw e; }
  finally { MPC.active--; MPC.waiting.shift()?.(); }
}
function mpcDown() { const e = new Error('Neither SkyBoT nor the Minor Planet Center checker is answering right now. Try again in a few minutes.'); e.status = 503; return e; }
function sexa(v, hours, dec) {
  const sign = v < 0 ? '-' : '+'; let a = Math.abs(v); if (hours) a /= 15;
  let h = Math.floor(a), m = Math.floor((a - h) * 60), sec = Math.round(((a - h) * 60 - m) * 600) / 10;   // 0.1 s / 0.1 "
  if (sec >= 60) { sec -= 60; m++; } if (m >= 60) { m -= 60; h++; }
  const f = x => String(x).padStart(2, '0');
  return (dec ? sign : '') + f(h) + ' ' + f(m) + ' ' + (sec < 10 ? '0' : '') + sec.toFixed(1);
}
async function mpcMovers(ra, dec, rad, jd, mjd) {
  const fieldKey = `${ra.toFixed(3)},${dec.toFixed(3)},${rad.toFixed(2)}`, tJD = +jd;
  return cachedJSON('moversmpc', `${fieldKey},${jd}`, 30 * DAY, async () => {
    // an answer already asked for (or being asked for) within an hour of this time serves this image too
    const near = MPC.recent.find(r => r.field === fieldKey && Math.abs(r.jd - tJD) <= MPC.share);
    if (near) { const a = await near.p; return { mjd, count: a.items.length, items: P.shiftItems(a.items, (tJD - near.jd) * 24), source: 'MPC' }; }
    const rec = { field: fieldKey, jd: tJD };
    rec.p = (async () => {
      if (Date.now() < MPC.downUntil) throw mpcDown();
      const d = new Date((tJD - 2440587.5) * 86400000), day = d.getUTCDate() + (d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600) / 24;
      const body = new URLSearchParams({ year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, '0'), day: day.toFixed(4), which: 'pos',
        ra: sexa(ra, true, false), decl: sexa(dec, false, true), TextArea: '', radius: String(Math.min(300, Math.max(5, Math.ceil(rad * 60)))), limit: '24.0', oc: '500',
        sort: 'd', mot: 'h', tmot: 's', pdes: 'u', needed: 'f', ps: 'n', type: 'p' }).toString();
      let text;
      try { text = await upstream('https://minorplanetcenter.net/cgi-bin/mpcheck.cgi', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MPC.timeout, retries: 1, lim: mpcLimited }); }
      catch (e) { if (!e.status || e.status >= 500) { MPC.downUntil = Math.max(MPC.downUntil, Date.now() + 110000); if (LOG) console.log('  MPC checker not answering (' + String(e.message).slice(0, 60) + '): paused for 2 minutes'); if (e.status !== 503) throw mpcDown(); } throw e; }
      const out = P.parseMpc(text);
      if (!out.ok) { const e = new Error('The MPC checker returned an unexpected reply'); e.status = 502; throw e; }
      // keep only objects inside the asked circle (the MPC minimum radius is 5 arcminutes)
      const c = Math.cos(dec * Math.PI / 180), items = out.items.filter(o => Math.hypot((o.ra - ra) * c, o.dec - dec) <= rad * 1.02);
      return { items };
    })();
    MPC.recent.push(rec); if (MPC.recent.length > 40) MPC.recent.shift();
    try { const a = await rec.p; if (LOG) console.log(`  known objects from the MPC checker: ${a.items.length}`); return { mjd, count: a.items.length, items: a.items, source: 'MPC' }; }
    catch (e) { MPC.recent = MPC.recent.filter(r => r !== rec); throw e; }
  });
}

async function skybotMovers(key, ra, dec, rad, jd, mjd, onSend) {
  // Known-object positions at a fixed past time do not change: keep them 30 days.
  return cachedJSON('movers', key, 30 * DAY, async () => {
    // Geocentric observer (code 500). SPHEREx is in low Earth orbit, so nearby objects can be off by an arcminute or so.
    const url = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php' +
      `?-ep=${jd}&-ra=${ra}&-dec=${dec}&-rs=${Math.round(rad * 3600)}&-mime=json&-output=basic&-observer=500&-filter=120&-objFilter=111&-refsys=EQJ2000&-from=ARCNAVE`;
    if (Date.now() < SKYBOT.downUntil) throw skybotDown();
    let text;
    // v0.44: onSend tells movers() the moment this request leaves the queue, so its hedge clock does not run while it waits
    const lim = onSend ? fn => skybotLimited(() => { onSend(); return fn(); }) : skybotLimited;
    try { text = await upstream(url, { timeout: SKYBOT.timeout, retries: 0, lim }); }   // waiting again does not help a service that is down
    catch (e) {
      if (e.status === 503 && /not answering/.test(e.message)) throw e;
      if (!e.status || e.status >= 500) { skybotTrip(); if (LOG) console.log('  SkyBoT not answering (' + String(e.message).slice(0, 60) + '): known-object checks paused, the MPC checker takes over'); throw skybotDown(); }
      throw e;
    }
    if (Date.now() >= SKYBOT.downUntil) { SKYBOT.downUntil = 0; SKYBOT.fails = 0; }
    const out = P.parseSkybot(text);
    if (!out.ok) { const e = new Error('SkyBoT returned an unexpected reply'); e.status = 502; throw e; }
    return { mjd, count: out.items.length, items: out.items };
  });
}
async function movers(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec');
  const rad = num(q.radius, 0.005, 10, 'radius'), mjd = num(q.mjd, 40000, 80000, 'mjd');
  const jd = (mjd + 2400000.5).toFixed(4);
  // Key at the same time precision as the query (1e-4 day = 9 s). It was 0.01 day: two exposures 6 minutes apart shared one
  // answer, so SkyBoT's predicted motion between them showed as 0 (seen live on 3865 Lindbloom).
  let sent; const sending = new Promise(r => { sent = r; });
  const sky = skybotMovers(`${ra.toFixed(3)},${dec.toFixed(3)},${rad.toFixed(2)},${jd}`, ra, dec, rad, jd, mjd, sent);
  if (process.env.SKYSHIFT_NO_MPC === '1') return sky;
  sky.catch(() => { /* handled below; may lose the race */ });
  // v0.17 hedge: if SkyBoT has not answered SKYBOT.hedgeMs after the request was SENT (v0.44: not counting the time it waited
  // for a free slot; at most 45 s in all), or it is known to be down, the MPC checker is asked as well and the first good
  // answer wins. A saved answer comes back at once and never reaches the MPC.
  let timer, cap; const first = await Promise.race([sky.then(v => ({ v }), e => ({ e })),
    sending.then(() => new Promise(r => { timer = setTimeout(() => r(null), SKYBOT.hedgeMs); })),
    new Promise(r => { cap = setTimeout(() => r(null), Math.max(45000, SKYBOT.hedgeMs)); })]);
  clearTimeout(timer); clearTimeout(cap);
  if (first && first.v) return first.v;
  if (first && first.e && !(first.e.status === 503 && /not answering/.test(first.e.message))) throw first.e;   // only "SkyBoT is down/slow" falls back
  const mpc = mpcMovers(ra, dec, rad, jd, mjd);
  if (first) return mpc;   // SkyBoT already failed
  try { return await Promise.any([sky, mpc]); }
  catch (agg) { throw agg.errors[1] || agg.errors[0]; }
}

async function horizons(q) {
  const num_ = q.num ? String(q.num).replace(/\D/g, '') : '';
  const name = String(q.name || '').slice(0, 60);
  const cmd = num_ ? `${num_};` : `DES=${name};`;
  const t0 = String(q.start || ''), t1 = String(q.stop || '');
  const okT = s => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s);
  if (!(num_ || name) || !okT(t0) || !okT(t1)) { const e = new Error('Need num or name, and start/stop as YYYY-MM-DD'); e.status = 400; throw e; }
  const step = /^\d+ ?(h|d|m)$/.test(String(q.step || '')) ? q.step : '1 d';
  const enc = encodeURIComponent;
  const url = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=json' +
    `&COMMAND='${enc(cmd)}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='500@399'` +
    `&START_TIME='${enc(t0)}'&STOP_TIME='${enc(t1)}'&STEP_SIZE='${enc(step)}'&QUANTITIES='1,9'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'`;
  return cachedJSON('horizons', url, 30 * DAY, async () => {
    const j = await upstream(url, { timeout: 45000, json: true });
    if (j.error) { const e = new Error('Horizons: ' + String(j.error).slice(0, 200)); e.status = 502; throw e; }
    const rows = P.parseHorizons(j.result || '');
    if (!rows.length) { const e = new Error('Horizons gave no ephemeris (name may be ambiguous)'); e.status = 404; throw e; }
    return { cmd, rows };
  });
}

/* ---------- debug bundle (local runs only) ---------- */
// Saves the cutouts this server has in memory (without PSF/VARIANCE since v0.4), the last archive searches and what the
// page sends (agent report, chosen images) into debug-cutouts/<time>/ so the real data can be inspected offline. Refused
// unless the request comes from this computer, and refused entirely when SKYSHIFT_PUBLIC=1 (set that on any public host).
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
function readBody(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const parts = [];
    req.on('data', d => { n += d.length; if (n > max) { const e = new Error('Body too large'); e.status = 400; rej(e); req.destroy(); } else parts.push(d); });
    req.on('end', () => res(Buffer.concat(parts).toString('utf8'))); req.on('error', rej);
  });
}
async function debugSave(req) {
  if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) { const e = new Error('Debug bundle is only available on a local run'); e.status = 404; throw e; }
  let page = null;
  const body = await readBody(req, 8e6);
  if (body.trim()) { try { page = JSON.parse(body); } catch { const e = new Error('Body must be JSON'); e.status = 400; throw e; } }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ROOT, 'debug-cutouts', stamp);
  await fs.promises.mkdir(dir, { recursive: true });
  const cutouts = []; let k = 0;
  for (const [url, gz] of CUTOUT) {
    const file = `cutout_${String(++k).padStart(2, '0')}.fits`, buf = zlib.gunzipSync(gz);
    await fs.promises.writeFile(path.join(dir, file), buf);
    cutouts.push({ file, url, bytes: buf.length });
  }
  const index = { savedAt: new Date().toISOString(), tool: 'ARCNAVE debug bundle', cutouts, searches: SEARCHES, page };
  await fs.promises.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  return { dir: path.relative(ROOT, dir), cutouts: cutouts.length, searches: SEARCHES.length };
}

/* ---------- validation scorecard (local runs only, v0.12) ---------- */
// The #scorecard mode of the page (public/app.js) runs the agents and the Hide Planet X map on a fixed list of fields and
// posts each result here; it is written to scorecard/<id>.json. Refused on a public host, like the debug bundle.
async function scorecardSave(req) {
  if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) { const e = new Error('Scorecard saving is only available on a local run'); e.status = 404; throw e; }
  let body; try { body = JSON.parse(await readBody(req, 4e6)); } catch (e) { if (e.status) throw e; const x = new Error('Body must be JSON'); x.status = 400; throw x; }
  const id = String(body.id || 'field').replace(/[^A-Za-z0-9_.+-]/g, '_').slice(0, 60);
  const dir = path.join(ROOT, 'scorecard');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, id + '.json');
  await fs.promises.writeFile(file, JSON.stringify({ ...body, savedAt: new Date().toISOString() }, null, 1));
  return { saved: path.relative(ROOT, file) };
}

/* ---------- routing ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.gif': 'image/gif', '.woff2': 'font/woff2' };
// v0.15.2: link previews (WhatsApp, X, LinkedIn...) need absolute image URLs, so pages say %ORIGIN% and the server fills in
// this site's address: PUBLIC_URL when set (set it on a public host), else the address the visitor used.
function siteOrigin(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  return (/^https?$/.test(proto) ? proto : 'http') + '://' + (/^[A-Za-z0-9.\-]+(:\d+)?$/.test(host) ? host : 'localhost');
}
function sendJSON(req, res, code, obj) {
  let b = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding' };
  if (b.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { b = zlib.gzipSync(b, { level: 4 }); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = b.length;
  res.writeHead(code, headers);
  res.end(b);
}
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/public/index.html' : pathname;
  if (rel.startsWith('/lib/fits.js')) rel = '/lib/fits.js';
  else if (rel.startsWith('/lib/wave.js')) rel = '/lib/wave.js';
  else if (rel.startsWith('/lib/slots.js')) rel = '/lib/slots.js';
  else if (rel.startsWith('/lib/planetx.js')) rel = '/lib/planetx.js';
  else if (rel.startsWith('/lib/s3cut.js')) rel = '/lib/s3cut.js';
  else if (rel.startsWith('/lib/spot.js')) rel = '/lib/spot.js';
  else if (!rel.startsWith('/public/')) rel = '/public' + rel;
  // developer pages (public/dev/) only on a local run, never on a public host
  if (rel.startsWith('/public/dev/') && (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req))) { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = [path.join(ROOT, 'public') + path.sep, path.join(ROOT, 'lib', 'fits.js'), path.join(ROOT, 'lib', 'wave.js'), path.join(ROOT, 'lib', 'slots.js'), path.join(ROOT, 'lib', 'planetx.js'), path.join(ROOT, 'lib', 's3cut.js'), path.join(ROOT, 'lib', 'spot.js')];
  if (!allowed.some(a => file === a || file.startsWith(a))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    if (path.extname(file) === '.html') data = Buffer.from(data.toString('utf8').split('%ORIGIN%').join(siteOrigin(req)));
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/public/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'Vary': 'Accept-Encoding' };
    if (data.length > 1024 && !['.mp3', '.gif', '.png', '.jpg'].includes(path.extname(file)) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { data = zlib.gzipSync(data, { level: 6 }); headers['Content-Encoding'] = 'gzip'; }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  try {
    if (url.pathname === '/api/debug/save' && req.method === 'POST') return sendJSON(req, res, 200, await debugSave(req));
    if (url.pathname === '/api/spherex/cutout' && req.method === 'POST') return sendJSON(req, res, 200, await cutoutPut(req, Object.fromEntries(url.searchParams)));
    if (url.pathname === '/api/dev/scorecard' && req.method === 'POST') return sendJSON(req, res, 200, await scorecardSave(req));
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    switch (url.pathname) {
      case '/api/resolve': return sendJSON(req, res, 200, await resolve(q));
      case '/api/spherex/search': return sendJSON(req, res, 200, await spherexSearch(q));
      case '/api/spherex/cutout': return await spherexCutout(q, req, res);
      case '/api/movers': return sendJSON(req, res, 200, await movers(q));
      case '/api/photcat': return sendJSON(req, res, 200, await photcat(q));
      case '/api/gaia': return sendJSON(req, res, 200, await gaia(q));
      case '/api/catwise': return sendJSON(req, res, 200, await catwise(q));
      case '/api/spherex/psf':   // developer check (public/dev/psfcheck.html): local runs only
        if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) return sendJSON(req, res, 404, { error: 'No such endpoint' });
        return sendJSON(req, res, 200, await spherexPsf(q));
      case '/api/horizons': return sendJSON(req, res, 200, await horizons(q));
      case '/api/health': return sendJSON(req, res, 200, { ok: true, version: require('./package.json').version, upstreamLimit: MAX_UPSTREAM, stats, cache: await cacheInfo() });
      default:
        if (url.pathname.startsWith('/api/')) return sendJSON(req, res, 404, { error: 'No such endpoint' });
        if (url.pathname.startsWith('/hips/')) return await hipsTile(req, res, url.pathname);
        return serveStatic(req, res, decodeURIComponent(url.pathname));
    }
  } catch (e) {
    const code = e.status && e.status >= 400 && e.status < 600 ? (e.status === 404 || e.status === 400 ? e.status : 502) : (e.name === 'AbortError' ? 504 : 502);
    if (!res.headersSent) sendJSON(req, res, code, { error: e.name === 'AbortError' ? 'Upstream timed out' : e.message });
    else res.end();
  }
});

if (require.main === module) { const seeded = seedCache(); if (seeded) console.log(`Demo data: ${seeded} files copied into the cache`); }
server.seedCache = seedCache;
if (require.main === module) server.listen(PORT, () => console.log(`ARCNAVE on http://localhost:${PORT}  (cache: ${CACHE_DIR}, ${MAX_UPSTREAM} parallel requests, ${IRSA_PARALLEL} IRSA image downloads at a time, ${RETRIES} retries)`));
module.exports = server;
module.exports._test = { readPsfZone, stripFits, stats, clearMemory: () => { cache.clear(); CUTOUT.clear(); FROZEN.at = 0; FRESH.clear(); }, prune, movers, SKYBOT, MPC, catwise };
