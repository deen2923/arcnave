/* ARCNAVE on Cloudflare (no server of its own): the /api/... answers the Node server gives (server.js) are made here, in
   the visitor's browser, with the same queries and the same parsers (lib/parsers.js, as window.ArcParsers).
   - Answers the team's PC had are static files: /_c/api/<kind>-<sha1 of key>.json, the same names the server uses.
   - New answers ask the archives through the site's small proxy (/_p, the Worker: deploy/cloudflare/worker.js), which
     keeps each archive reply at Cloudflare's edge so the next visitor gets it at once.
   - Cutouts: the PC's are static files (/_c/cutouts/<sha1>.fgz); a new one is read from NASA's S3 copy by the page
     itself (public/app.js loadViaS3), as on any public host.
   Loaded first on every page by deploy/cloudflare/build.mjs; it only takes over fetch() calls to this site's /api/. */
(function () {
  'use strict';
  const realFetch = window.fetch.bind(window);
  const DAY = 864e5;
  const P = () => window.ArcParsers;
  let VERSION = null;

  /* ---------- helpers ---------- */
  const err = (msg, status) => Object.assign(new Error(msg), { status });
  const num = (v, lo, hi, name) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw err('Bad parameter: ' + name, 400); return x; };
  async function sha1(s) {
    const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const retryable = e => [408, 429, 500, 502, 503, 504].includes(e.status) || e.name === 'AbortError' || e.name === 'TimeoutError' || /fetch|network/i.test(e.message || '');

  // an archive request through the site's proxy; ttl = how long Cloudflare's edge may keep the reply (seconds, 0 = never)
  async function upstreamOnce(url, o) {
    const qs = '/_p?u=' + encodeURIComponent(url) + (o.ttl ? '&t=' + Math.round(o.ttl) : '');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), o.timeout || 60000);
    try {
      const r = await realFetch(qs, { method: o.body ? 'POST' : 'GET', body: o.body, headers: o.headers, signal: ctl.signal });
      if (!r.ok) { const body = (await r.text()).slice(0, 300); throw err(`Upstream ${r.status}: ${body}`, r.status); }
      return o.json ? await r.json() : o.binary ? await r.arrayBuffer() : await r.text();
    } finally { clearTimeout(t); }
  }
  async function upstream(url, o = {}) {
    const tries = o.retries != null ? o.retries : 2;
    for (let k = 0; ; k++) {
      try { return await upstreamOnce(url, o); }
      catch (e) { if (k >= tries || !retryable(e)) throw e; await sleep(Math.min(15000, 2000 * 2 ** k) + Math.random() * 800); }
    }
  }
  // limits like the server's: the archives answer "busy" when one visitor asks too much at once
  function pool(max) { let act = 0; const wait = []; return async fn => { while (act >= max) await new Promise(r => wait.push(r)); act++; try { return await fn(); } finally { act--; wait.shift()?.(); } }; }
  const limited = pool(8);

  // answers: the static copy the team's PC had, then this page's memory, then the archive
  const MEM = new Map();
  async function cachedJSON(kind, key, ttlMs, fn, fresh = false) {
    const mk = kind + ':' + key;
    if (!fresh && MEM.has(mk)) return MEM.get(mk);
    const p = (async () => {
      const name = kind + '-' + await sha1(key) + '.json';
      if (!fresh) {
        try { const r = await realFetch('/_c/api/' + name); if (r.ok && /json/.test(r.headers.get('Content-Type') || '')) return await r.json(); } catch { /* not there */ }
      }
      return limited(fn);
    })();
    MEM.set(mk, p); p.catch(() => MEM.delete(mk));
    if (MEM.size > 400) MEM.delete(MEM.keys().next().value);
    return p;
  }
  const ttlS = ms => Math.round(ms / 1000);

  /* ---------- the endpoints (same queries and answers as server.js) ---------- */
  const SESAME = { downUntil: 0 };
  function parseNed(j) {
    const pos = j && j.ResultCode === 3 && j.Preferred && j.Preferred.Position;
    return pos && Number.isFinite(pos.RA) && Number.isFinite(pos.Dec) ? { ra: pos.RA, dec: pos.Dec, name: j.Preferred.Name || null, source: 'NED' } : null;
  }
  async function resolve(q) {
    const name = String(q.q || '').trim();
    if (!name || name.length > 100) throw err('Missing name', 400);
    return cachedJSON('resolve', name.toLowerCase(), 30 * DAY, async () => {
      let hit = null;
      if (Date.now() >= SESAME.downUntil) {
        try { hit = P().parseSesame(await upstream('https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?' + encodeURIComponent(name), { timeout: 8000, retries: 0, ttl: ttlS(30 * DAY) })); }
        catch (e) { if (!e.status || e.status >= 500) SESAME.downUntil = Date.now() + 300000; }
      }
      if (!hit) {
        try {
          const j = await upstream('https://ned.ipac.caltech.edu/srs/ObjectLookup', { body: 'json=' + encodeURIComponent(JSON.stringify({ name: { v: name } })),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, retries: 1, json: true });
          hit = parseNed(j);
        } catch { /* not found below */ }
      }
      if (!hit) throw err('Name not found', 404);
      return hit;
    });
  }

  const IRSA_TAP = 'https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=';
  const FRESH = new Map();
  async function spherexSearch(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), key = `${ra.toFixed(3)},${dec.toFixed(3)}`;
    const fresh = q.fresh === '1' && !(Date.now() - (FRESH.get(key) || 0) < 60e3);
    if (fresh) FRESH.set(key, Date.now());
    const kind = q.latest === '1' ? 'searchl' : 'search';
    const run = async () => {
      const adql =
        "SELECT TOP 4000 'https://irsa.ipac.caltech.edu/' || a.uri AS download_url, p.obs_publisher_did, " +
        'p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper, p.poly ' +
        'FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ' +
        `WHERE CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) = 1 ORDER BY p.time_bounds_lower`;
      // a fresh check must reach the archive: no edge copy
      const images = P().normaliseSpherex(P().parseCSV(await upstream(IRSA_TAP + encodeURIComponent(adql), { timeout: 90000, retries: 1, ttl: fresh ? 0 : ttlS(DAY) })));
      return { ra, dec, count: images.length, images, checkedAt: new Date().toISOString() };
    };
    if (!fresh) return cachedJSON(kind, key, DAY, run);
    // "Check for new data": the archive's list now; a frozen list (a test field) is shown, not replaced
    let saved = null; try { const r = await realFetch('/_c/api/' + kind + '-' + await sha1(key) + '.json'); if (r.ok) saved = await r.json(); } catch { /* none */ }
    const now = await run();
    return saved && saved.frozen ? Object.assign({}, now, { frozen: true, frozenKept: true }) : now;
  }

  const RELEASES_BUILT_WITH = ['qr2', 'qr3', 'dr1'];
  const relRank = r => { const m = /^([a-z]+)(\d+)$/.exec(r) || [, r, 0]; return (m[1] === 'dr' ? 1e6 : m[1] === 'qr' ? 0 : 5e5) + +m[2]; };
  async function releases(q = {}) {
    const run = async () => {
      const xml = await upstream('https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/?list-type=2&delimiter=/', { timeout: 20000, retries: 1, ttl: q.fresh === '1' ? 0 : 3600 });
      const names = [...xml.matchAll(/<Prefix>([a-z]+\d+)\/<\/Prefix>/gi)].map(m => m[1].toLowerCase());
      if (!names.length) throw err('The SPHEREx bucket listed no release folders', 502);
      const list = [...new Set(names)].sort((a, b) => relRank(a) - relRank(b));
      return { releases: list.map(x => x.toUpperCase()), newest: list[list.length - 1].toUpperCase(),
        newSinceBuild: list.filter(x => !RELEASES_BUILT_WITH.includes(x)).map(x => x.toUpperCase()), checkedAt: new Date().toISOString(), via: 'S3 nasa-irsa-spherex' };
    };
    // the bucket listing is asked live (once an hour at the edge), so a new release shows without a rebuild
    const r = q.fresh === '1' ? await run() : await (MEM.get('releases') || (MEM.set('releases', run().catch(e => { MEM.delete('releases'); throw e; })), MEM.get('releases')));
    return Object.assign({ builtWith: RELEASES_BUILT_WITH.map(x => x.toUpperCase()) }, r);
  }

  const f = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const tsv = t => { const L = t.split('\n').filter(l => l && !l.startsWith('#')); const i = L.findIndex(l => /^-+/.test(l)); if (i < 1) return []; const h = L[i - 1].split('\t').map(x => x.trim());
    return L.slice(i + 1).map(l => { const c = l.split('\t'); return Object.fromEntries(h.map((k, j) => [k, (c[j] || '').trim()])); }); };
  async function photcat(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(30, Math.max(2, +q.r || 12));
    return cachedJSON('photcat', `${ra.toFixed(5)},${dec.toFixed(5)},${r}`, 30 * DAY, async () => {
      const circ = `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${(r / 3600).toFixed(6)})) = 1`;
      const tap = a => upstream(IRSA_TAP + encodeURIComponent(a), { timeout: 30000, retries: 1, ttl: ttlS(30 * DAY) });
      const viz = (src, cols) => upstream(`https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=${src}&-c=${ra}${dec >= 0 ? '%2B' : ''}${dec}&-c.rs=${r}&-out=${cols}&-out.max=50`, { timeout: 30000, retries: 0, ttl: ttlS(30 * DAY) });
      const out = { ra, dec, r, twomass: [], wise: [], via: {} };
      try {
        out.twomass = P().parseCSV(await tap(`SELECT ra, dec, j_m, h_m, k_m, ph_qual, cc_flg FROM fp_psc WHERE ${circ}`))
          .map(o => ({ ra: f(o.ra), dec: f(o.dec), J: f(o.j_m), H: f(o.h_m), K: f(o.k_m), q: o.ph_qual, cc: o.cc_flg })); out.via.twomass = 'IRSA';
      } catch {
        try { out.twomass = tsv(await viz('II/246/out', 'RAJ2000,DEJ2000,Jmag,Hmag,Kmag,Qflg,Cflg')).map(o => ({ ra: f(o.RAJ2000), dec: f(o.DEJ2000), J: f(o.Jmag), H: f(o.Hmag), K: f(o.Kmag), q: o.Qflg, cc: o.Cflg })); out.via.twomass = 'VizieR'; }
        catch { out.via.twomass = 'unavailable'; }
      }
      try {
        out.wise = P().parseCSV(await tap(`SELECT ra, dec, w1mpro, w2mpro, ph_qual, cc_flags FROM allwise_p3as_psd WHERE ${circ}`))
          .map(o => ({ ra: f(o.ra), dec: f(o.dec), W1: f(o.w1mpro), W2: f(o.w2mpro), q: o.ph_qual, cc: o.cc_flags })); out.via.wise = 'IRSA';
      } catch {
        try { out.wise = tsv(await viz('II/328/allwise', 'RAJ2000,DEJ2000,W1mag,W2mag,qph,ccf')).map(o => ({ ra: f(o.RAJ2000), dec: f(o.DEJ2000), W1: f(o.W1mag), W2: f(o.W2mag), q: o.qph, cc: o.ccf })); out.via.wise = 'VizieR'; }
        catch { out.via.wise = 'unavailable'; }
      }
      if (out.via.twomass === 'unavailable' && out.via.wise === 'unavailable') throw err('2MASS and WISE catalogues are not answering right now', 503);
      return out;
    });
  }

  async function gaia(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(1.2, Math.max(0.02, +q.r || 0.36)), gmax = Math.min(20, Math.max(8, +q.g || 18));
    return cachedJSON('gaia', `${ra.toFixed(4)},${dec.toFixed(4)},${r.toFixed(3)},${gmax}`, 30 * DAY, async () => {
      let stars = null, via = null;
      const sel = o => ({ id: o.source_id, ra: f(o.ra), dec: f(o.dec), plx: f(o.parallax), pmra: f(o.pmra), pmdec: f(o.pmdec), g: f(o.phot_g_mean_mag) });
      try {
        const adql = `SELECT TOP 3000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag FROM gaia_dr3_source ` +
          `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) = 1 AND phot_g_mean_mag < ${gmax} ORDER BY phot_g_mean_mag`;
        stars = P().parseCSV(await upstream(IRSA_TAP + encodeURIComponent(adql), { timeout: 60000, retries: 1, ttl: ttlS(30 * DAY) })).map(sel); via = 'IRSA';
      } catch { try {
        const t = await upstream(`https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/355/gaiadr3&-c=${ra}${dec >= 0 ? '%2B' : ''}${dec}&-c.rd=${r}&-out=Source,RA_ICRS,DE_ICRS,Plx,pmRA,pmDE,Gmag&Gmag=%3C${gmax}&-sort=Gmag&-out.max=3000`, { timeout: 60000, retries: 0, ttl: ttlS(30 * DAY) });
        stars = tsv(t).map(o => ({ id: o.Source, ra: f(o.RA_ICRS), dec: f(o.DE_ICRS), plx: f(o.Plx), pmra: f(o.pmRA), pmdec: f(o.pmDE), g: f(o.Gmag) })); via = 'VizieR';
      } catch {
        const adql = `SELECT TOP 3000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag FROM dbo.gaia_source ` +
          `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) = 1 AND phot_g_mean_mag < ${gmax} ORDER BY phot_g_mean_mag`;
        stars = P().parseCSV(await upstream('https://mast.stsci.edu/vo-tap/api/v0.1/gaiadr3/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql), { timeout: 60000, retries: 0, ttl: ttlS(30 * DAY) })).map(sel); via = 'MAST';
      } }
      return { ra, dec, r, gmax, epoch: 2016.0, via, stars: stars.filter(s => s.ra != null && s.dec != null) };
    });
  }

  async function catwise(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(0.8, Math.max(0.02, +q.r || 0.36));
    return cachedJSON('catwise', `${ra.toFixed(4)},${dec.toFixed(4)},${r.toFixed(3)}`, 30 * DAY, async () => {
      const adql = 'SELECT TOP 40000 source_name, ra_pm, dec_pm, pmra, pmdec, sigpmra, sigpmdec, w1mpro, w2mpro, w2snr, nb, ab_flags FROM catwise_2020 ' +
        `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) = 1 AND w2snr > 5`;
      const rows = P().parseCSV(await upstream(IRSA_TAP + encodeURIComponent(adql), { timeout: 90000, retries: 1, ttl: ttlS(30 * DAY) }));
      const g = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? +x.toFixed(d) : null; };
      const src = rows.map(o => [o.source_name, g(o.ra_pm, 7), g(o.dec_pm, 7), g(o.pmra, 4), g(o.pmdec, 4), g(o.sigpmra, 4), g(o.sigpmdec, 4), g(o.w1mpro, 3), g(o.w2mpro, 3), g(o.w2snr, 1), +o.nb || 0, o.ab_flags || ''])
        .filter(s => s[1] != null && s[2] != null);
      return { ra, dec, r, epochMjd: 57170, via: 'IRSA', cols: ['name', 'ra', 'dec', 'pmra', 'pmdec', 'spmra', 'spmdec', 'w1', 'w2', 'snr', 'nb', 'ab'], src };
    });
  }

  function neoNights(rows, max = 8) {
    const by = new Map();
    for (const o of rows) {
      const t = parseFloat(o.t), id = String(o.id || '');
      if (!Number.isFinite(t) || !/^\d{13}$/.test(id) || /^(DARK|FLAT|BIAS)/i.test(String(o.target || '').trim())) continue;
      const d = Math.floor(t); if (!by.has(d)) by.set(d, []); by.get(d).push({ id, t, target: String(o.target || '').slice(0, 60) });
    }
    const nights = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([d, fr]) => {
      fr.sort((a, b) => a.t - b.t); const tc = {}; for (const x of fr) tc[x.target] = (tc[x.target] || 0) + 1;
      return { date: new Date((d - 40587) * 864e5).toISOString().slice(0, 10), n: fr.length, target: Object.entries(tc).sort((a, b) => b[1] - a[1])[0][0], id: fr[fr.length >> 1].id };
    });
    if (nights.length <= max) return { nights, total: nights.length };
    return { nights: Array.from({ length: max }, (_, i) => nights[Math.round(i * (nights.length - 1) / (max - 1))]), total: nights.length };
  }
  async function neossat(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), r = Math.min(1, Math.max(0.01, +q.r || 0.25));
    return cachedJSON('neossat', `${ra.toFixed(3)},${dec.toFixed(3)},${r.toFixed(3)},nights`, 7 * DAY, async () => {
      const where = `o.collection = 'NEOSSAT' AND INTERSECTS(CIRCLE('ICRS', ${ra}, ${dec}, ${r}), p.position_bounds) = 1`;
      const tap = a => upstream('https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/argus/sync?LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(a), { timeout: 60000, retries: 1, ttl: ttlS(7 * DAY) });
      const [all] = P().parseCSV(await tap(`SELECT COUNT(*) AS n, MIN(p.time_bounds_lower) AS t0, MAX(p.time_bounds_lower) AS t1 FROM caom2.Plane AS p JOIN caom2.Observation AS o ON p.obsID = o.obsID WHERE ${where}`));
      const n = +(all && all.n) || 0;
      const targets = n ? P().parseCSV(await tap(`SELECT TOP 5 o.target_name AS name, COUNT(*) AS n FROM caom2.Plane AS p JOIN caom2.Observation AS o ON p.obsID = o.obsID WHERE ${where} GROUP BY o.target_name ORDER BY n DESC`))
        .map(t => ({ name: String(t.name || '').slice(0, 60), n: +t.n || 0 })).filter(t => t.n) : [];
      const day = m => { const x = parseFloat(m); return Number.isFinite(x) ? new Date((x - 40587) * 864e5).toISOString().slice(0, 10) : null; };
      let nights = [], nightsTotal = 0;
      if (n) { try {
        const rows = P().parseCSV(await tap(`SELECT TOP 5000 o.observationID AS id, o.target_name AS target, p.time_bounds_lower AS t FROM caom2.Plane AS p JOIN caom2.Observation AS o ON p.obsID = o.obsID WHERE ${where} AND p.productID = 'raw' ORDER BY p.time_bounds_lower`));
        ({ nights, total: nightsTotal } = neoNights(rows));
      } catch { /* the count still stands */ } }
      return { ra, dec, r, n, first: n ? day(all.t0) : null, last: n ? day(all.t1) : null, targets, nights, nightsTotal, via: 'CADC' };
    });
  }

  // known moving objects: SkyBoT (IMCCE), with the Minor Planet Center's checker as the fallback when SkyBoT is slow or down
  const SKYBOT = { downUntil: 0, fails: 0, hedgeMs: 12000 }, skybotPool = pool(6), mpcPool = pool(2), MPC = { downUntil: 0 };
  const downErr = () => err('SkyBoT (the known-object service) is not answering right now. Try again in a few minutes.', 503);
  function sexa(v, hours, dec) {
    const sign = v < 0 ? '-' : '+'; let a = Math.abs(v); if (hours) a /= 15;
    let h = Math.floor(a), m = Math.floor((a - h) * 60), sec = Math.round(((a - h) * 60 - m) * 600) / 10;
    if (sec >= 60) { sec -= 60; m++; } if (m >= 60) { m -= 60; h++; }
    const z = x => String(x).padStart(2, '0');
    return (dec ? sign : '') + z(h) + ' ' + z(m) + ' ' + (sec < 10 ? '0' : '') + sec.toFixed(1);
  }
  function skybotMovers(key, ra, dec, rad, jd, mjd) {
    return cachedJSON('movers', key, 30 * DAY, () => skybotPool(async () => {
      if (Date.now() < SKYBOT.downUntil) throw downErr();
      const url = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php' +
        `?-ep=${jd}&-ra=${ra}&-dec=${dec}&-rs=${Math.round(rad * 3600)}&-mime=json&-output=basic&-observer=500&-filter=120&-objFilter=111&-refsys=EQJ2000&-from=ARCNAVE`;
      let text;
      try { text = await upstream(url, { timeout: 30000, retries: 0, ttl: ttlS(30 * DAY) }); }
      catch (e) { if (!e.status || e.status >= 500) { SKYBOT.downUntil = Date.now() + [60, 180, 600, 1200][Math.min(SKYBOT.fails++, 3)] * 1000; throw downErr(); } throw e; }
      SKYBOT.fails = 0;
      const out = P().parseSkybot(text);
      if (!out.ok) throw err('SkyBoT returned an unexpected reply', 502);
      return { mjd, count: out.items.length, items: out.items };
    }));
  }
  function mpcMovers(ra, dec, rad, jd, mjd) {
    return cachedJSON('moversmpc', `${ra.toFixed(3)},${dec.toFixed(3)},${rad.toFixed(2)},${jd}`, 30 * DAY, () => mpcPool(async () => {
      if (Date.now() < MPC.downUntil) throw err('Neither SkyBoT nor the Minor Planet Center checker is answering right now. Try again in a few minutes.', 503);
      const tJD = +jd, d = new Date((tJD - 2440587.5) * 86400000), day = d.getUTCDate() + (d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600) / 24;
      const body = new URLSearchParams({ year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, '0'), day: day.toFixed(4), which: 'pos',
        ra: sexa(ra, true, false), decl: sexa(dec, false, true), TextArea: '', radius: String(Math.min(300, Math.max(5, Math.ceil(rad * 60)))), limit: '24.0', oc: '500',
        sort: 'd', mot: 'h', tmot: 's', pdes: 'u', needed: 'f', ps: 'n', type: 'p' }).toString();
      let text;
      try { text = await upstream('https://minorplanetcenter.net/cgi-bin/mpcheck.cgi', { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 45000, retries: 1 }); }
      catch (e) { if (!e.status || e.status >= 500) MPC.downUntil = Date.now() + 110000; throw e; }
      const out = P().parseMpc(text);
      if (!out.ok) throw err('The MPC checker returned an unexpected reply', 502);
      const c = Math.cos(dec * Math.PI / 180), items = out.items.filter(o => Math.hypot((o.ra - ra) * c, o.dec - dec) <= rad * 1.02);
      return { mjd, count: items.length, items, source: 'MPC' };
    }));
  }
  async function movers(q) {
    const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec');
    const rad = num(q.radius, 0.005, 10, 'radius'), mjd = num(q.mjd, 40000, 80000, 'mjd');
    const jd = (mjd + 2400000.5).toFixed(4);
    const sky = skybotMovers(`${ra.toFixed(3)},${dec.toFixed(3)},${rad.toFixed(2)},${jd}`, ra, dec, rad, jd, mjd);
    sky.catch(() => { /* handled below */ });
    let timer; const first = await Promise.race([sky.then(v => ({ v }), e => ({ e })), new Promise(r => { timer = setTimeout(() => r(null), SKYBOT.hedgeMs); })]);
    clearTimeout(timer);
    if (first && first.v) return first.v;
    if (first && first.e && !(first.e.status === 503 && /not answering/.test(first.e.message))) throw first.e;
    const mpc = mpcMovers(ra, dec, rad, jd, mjd);
    if (first) return mpc;
    try { return await Promise.any([sky, mpc]); } catch (agg) { throw agg.errors[1] || agg.errors[0]; }
  }

  async function horizons(q) {
    const num_ = q.num ? String(q.num).replace(/\D/g, '') : '';
    const name = String(q.name || '').slice(0, 60);
    const cmd = num_ ? `${num_};` : `DES=${name};`;
    const t0 = String(q.start || ''), t1 = String(q.stop || '');
    const okT = s => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s);
    if (!(num_ || name) || !okT(t0) || !okT(t1)) throw err('Need num or name, and start/stop as YYYY-MM-DD', 400);
    const step = /^\d+ ?(h|d|m)$/.test(String(q.step || '')) ? q.step : '1 d';
    const enc = encodeURIComponent;
    const url = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=json' +
      `&COMMAND='${enc(cmd)}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='500@399'` +
      `&START_TIME='${enc(t0)}'&STOP_TIME='${enc(t1)}'&STEP_SIZE='${enc(step)}'&QUANTITIES='1,9'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'`;
    return cachedJSON('horizons', url, 30 * DAY, async () => {
      const j = await upstream(url, { timeout: 45000, json: true, ttl: ttlS(30 * DAY) });
      if (j.error) throw err('Horizons: ' + String(j.error).slice(0, 200), 502);
      const rows = P().parseHorizons(j.result || '');
      if (!rows.length) throw err('Horizons gave no ephemeris (name may be ambiguous)', 404);
      return { cmd, rows };
    });
  }

  // cutouts: the copy the team's PC had (a static file), else "not here" and the page reads NASA's S3 copy itself
  function cutoutKey(q) {
    let u; try { u = new URL(String(q.url)); } catch { throw err('Bad url', 400); }
    if (u.protocol !== 'https:' || u.hostname !== 'irsa.ipac.caltech.edu' || !u.pathname.startsWith('/ibe/') || u.search) throw err('URL not allowed', 400);
    const ra = +num(q.ra, 0, 360, 'ra').toFixed(5), dec = +num(q.dec, -90, 90, 'dec').toFixed(5), size = +num(q.size, 0.01, 1.0, 'size').toFixed(4);
    u.search = `?center=${ra},${dec}&size=${size}`;
    return u.toString();
  }
  async function cutout(q) {
    const key = cutoutKey(q);
    const r = await realFetch('/_c/cutouts/' + await sha1(key) + '.fgz');
    if (r.ok && r.body) {
      const body = r.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/fits', 'X-Arcnave-Cache': 'static' } });
    }
    if (q.cached === '1') return new Response(null, { status: 204, headers: { 'X-Arcnave-Put': '0', 'X-Arcnave-Server-S3': '0' } });
    // the page could not read S3 either: IRSA's own cutout service, through the proxy (slow, 25-45 s, but it works)
    const buf = await upstream(key, { timeout: 180000, binary: true, retries: 2, ttl: ttlS(30 * DAY) });
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/fits', 'X-Arcnave-Cache': 'irsa' } });
  }

  async function health() {
    if (!VERSION) { try { VERSION = await (await realFetch('/edge-version.json')).json(); } catch { VERSION = {}; } }
    return { ok: true, version: VERSION.version || null, host: 'cloudflare', built: VERSION.built || null };
  }

  const ROUTES = {
    '/api/resolve': resolve, '/api/spherex/search': spherexSearch, '/api/spherex/releases': releases, '/api/movers': movers,
    '/api/photcat': photcat, '/api/gaia': gaia, '/api/catwise': catwise, '/api/neossat': neossat, '/api/horizons': horizons, '/api/health': health
  };
  async function handle(url, init) {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const q = Object.fromEntries(url.searchParams);
    try {
      if (url.pathname === '/api/spherex/cutout') {
        if (method !== 'GET') return json({ error: 'Only on a local run' }, 404);   // a public host keeps no visitor uploads
        return await cutout(q);
      }
      if (method !== 'GET') return json({ error: 'Only on a local run' }, 404);   // debug bundle, scorecard
      const fn = ROUTES[url.pathname];
      if (!fn) return json({ error: 'No such endpoint' }, 404);
      return json(await fn(q));
    } catch (e) {
      const code = e.status && e.status >= 400 && e.status < 600 ? (e.status === 404 || e.status === 400 ? e.status : 502) : (e.name === 'AbortError' ? 504 : 502);
      return json({ error: e.name === 'AbortError' ? 'Upstream timed out' : e.message }, code);
    }
  }

  window.fetch = function (input, init) {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/api/')) return handle(url, init || (input instanceof Request ? { method: input.method } : undefined));
    } catch { /* not ours */ }
    return realFetch(input, init);
  };
  window.ARC_EDGE = true;
})();
