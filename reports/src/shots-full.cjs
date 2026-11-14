// Full-report screenshots of v0.57.8 (server on port 8084): every main feature, desktop and phone, with real Chrome
// (headless). Usage: node reports/src/shots-full.cjs <out-dir> [job,job,...]. Each job is independent: one failure is
// logged and the rest still run. Waits are generous: fields come from the local cache (8-12 s), searches take longer.
// No npm packages: a tiny Chrome DevTools Protocol driver over Node's built-in WebSocket (Node 22+), puppeteer-like.
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const puppeteer = {
  async launch({ args = [] } = {}) {
    const port = 9400 + Math.floor(Math.random() * 400), prof = path.join(OUT, '.chrome-prof');
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', ...args, 'about:blank'], { stdio: 'ignore' });
    const J = `http://127.0.0.1:${port}/json`;
    for (let k = 0; k < 60; k++) { try { await (await fetch(J + '/version')).json(); break; } catch { await sleep(500); } }
    return {
      async newPage() {
        const t = await (await fetch(J + '/new?about:blank', { method: 'PUT' })).json();
        const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
        let id = 0; const pend = new Map(), pg = { errs: [] };
        ws.addEventListener('message', e => { const m = JSON.parse(e.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
          else if (m.method === 'Runtime.exceptionThrown') pg.errs.push(String((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text).slice(0, 120)); });
        const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        await cmd('Page.enable'); await cmd('Runtime.enable');
        pg.on = () => { };
        pg.setViewport = v => cmd('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor || 1, mobile: !!v.isMobile })
          .then(() => v.hasTouch ? cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }) : null);
        pg.evaluateOnNewDocument = fn => cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(${fn})()` });
        pg.goto = url => cmd('Page.navigate', { url });
        pg.evaluate = async (fn, arg) => { const r = await cmd('Runtime.evaluate', { expression: `(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
          if (r.result && r.result.exceptionDetails) throw new Error(String((r.result.exceptionDetails.exception || {}).description || 'eval error').slice(0, 160)); return r.result && r.result.result ? r.result.result.value : undefined; };
        pg.screenshot = async ({ path: f }) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); };
        pg.close = async () => { try { ws.close(); await fetch(J + '/close/' + t.id); } catch { } };
        return pg;
      },
      async close() { proc.kill(); },
    };
  },
};
const BASE = 'http://localhost:8084/';
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DESK = { width: 1440, height: 860 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const done = [];

async function open(b, view, hash) {
  const p = await b.newPage();
  await p.setViewport(view);
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('arcnave.coach', 'done'); localStorage.setItem('arcnave.seen', '1'); } catch { } });
  await p.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  return p;
}
const until = async (p, fn, ms = 180000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(800); } return false; };
const report = p => until(p, () => typeof S !== 'undefined' && !!S.report, 240000);
const clean = p => p.evaluate(() => { document.querySelectorAll('.coach,.qs,#coach,#qstart').forEach(e => e.remove && e.remove()); const t = document.getElementById('toast'); if (t) t.hidden = true; }).catch(() => { });
async function shot(p, name, note) { await clean(p); await p.screenshot({ path: path.join(OUT, name + '.png') }); done.push([name, note || '']); log('  shot', name); }
const mode = (p, m) => p.evaluate(m => { const t = document.querySelector(`[role=tab][data-m="${m}"]`); if (t) t.click(); return !!t; }, m);

const jobs = {
  async landing(b) {
    const p = await open(b, { ...DESK, height: 900 }, ''); await p.evaluate(() => { localStorage.clear(); location.reload(); }); await sleep(4000);
    await p.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    await shot(p, '01-landing-hero', 'Start page');
    for (const [id, sel] of [['targets', '#lp-targets'], ['tested', '#tested, #lp-tested'], ['how', '#how, .lp-steps']]) {
      const ok = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; (e.closest('section') || e).scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); return true; }, sel);
      if (ok) { await sleep(6000); await shot(p, '02-landing-' + id); }
    }
    await p.close();
  },
  async tamil(b) {
    const p = await open(b, { ...DESK, height: 900 }, '#lang=ta'); await sleep(3000);
    await p.evaluate(() => { const s = document.querySelector('select[data-lang]'); if (s) { s.value = 'ta'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await sleep(1500); await shot(p, '03-landing-tamil', 'Start page in Tamil'); await p.close();
  },
  async wholesky(b) {
    const p = await open(b, DESK, '#ct=barnard'); await p.evaluate(() => { localStorage.clear(); location.reload(); }); await sleep(2000); await report(p); await sleep(2000); await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Whole sky map/.test(x.textContent)).click()); await sleep(9000); await shot(p, '04-whole-sky', 'Whole-sky map'); await p.close();
  },
  async barnard(b) {
    const p = await open(b, DESK, '#ct=barnard'); log('barnard report', await report(p)); await sleep(4000);
    await shot(p, '10-target-barnard', "Barnard's Star target card");
    for (const m of ['time', 'blink', 'swipe', 'diff', 'change']) { await mode(p, m); await sleep(m === 'blink' ? 2500 : 3500); await shot(p, '11-mode-' + m, 'View mode: ' + m); }
    await mode(p, 'time'); await sleep(2000);
    await p.evaluate(() => document.getElementById('gaiab').click()); await until(p, () => !!(GAIA.data), 40000); await sleep(2500);
    await shot(p, '12-gaia-overlay', 'Gaia DR3 overlay with motion arrows');
    await p.evaluate(() => { const s = GAIA.data.stars.slice().sort((a, c) => a.g - c.g)[0]; showGaia(s); gaiaMeasure(s); }); await sleep(3000);
    await shot(p, '13-gaia-measure', 'Measure its motion on a Gaia star');
    await p.evaluate(() => document.getElementById('flagsb').click()); await sleep(2500); await shot(p, '14-flags', 'Contamination flags');
    await p.evaluate(() => document.getElementById('flagsb').click()); await sleep(800);
    await p.evaluate(() => document.getElementById('deepb').click()); await sleep(4000);
    await until(p, () => !/Reading \d+ of/.test(document.getElementById('card').innerText), 180000); await sleep(3000);
    await shot(p, '15-deep-view', 'Deep view: the 6 detectors added up');
    await p.evaluate(() => document.getElementById('elsb').click());
    await until(p, () => /NEOSSat/.test(document.getElementById('card').innerText) && document.querySelectorAll('#card img').length > 0, 60000); await sleep(4000);
    await shot(p, '16-elsewhere', 'This spot elsewhere (all challenge resources, NEOSSat)');
    await p.evaluate(() => { const c = document.getElementById('ctr'); c.value = 2; c.dispatchEvent(new Event('input')); document.getElementById('invb').click(); }); await mode(p, 'time'); await sleep(2500);
    await shot(p, '17-contrast-invert', 'Contrast + Invert (WiseView style)');
    await p.evaluate(() => { const c = document.getElementById('ctr'); c.value = 0; setView({ gain: 1, invert: false }); }); await sleep(500);
    await p.evaluate(() => { const s = document.getElementById('survey'); s.value = 'spherex'; s.dispatchEvent(new Event('change')); S.al.setFov(3); document.getElementById('card').hidden = true; }); await sleep(9000);
    await shot(p, '18-spherex-dr1-sky', "SPHEREx's own DR1 all-sky map as the base sky");
    log('barnard errors', p.errs.join(' | ') || 'none'); await p.close();
  },
  async film(b) {
    for (const ct of ['barnard', 'epsindb']) {
      const p = await open(b, DESK, '#ct=' + ct); await report(p); await sleep(3000);
      await p.evaluate(() => document.getElementById('mvb').click());
      const on = await until(p, () => typeof MOVIE !== 'undefined' && MOVIE.on, 240000); await sleep(6000);
      await shot(p, `20-film-${ct}`, `Film (🎬 Animate) on ${ct}`); log(ct, 'film', on); await sleep(3000);
      if (ct === 'epsindb') await shot(p, '21-film-epsindb-b', 'Film, next pass');
      await p.close();
    }
  },
  async wise(b) {
    const p = await open(b, DESK, '#ct=wise0855'); await report(p); await sleep(3000);
    await shot(p, '30-target-wise0855', 'WISE 0855 target card');
    await p.evaluate(() => document.getElementById('cwb').click()); await until(p, () => !!(CW.data), 60000); await sleep(3000);
    await shot(p, '31-wise-overlay', 'CatWISE2020 overlay: movers and very red sources'); await p.close();
  },
  async variables(b) {
    for (const ct of ['rwaur', 'rdra', 'epsindb']) { const p = await open(b, DESK, '#ct=' + ct); await report(p); await sleep(5000); await shot(p, `32-target-${ct}`, ct + ' target card'); await p.close(); }
  },
  async spectrum(b) {
    const p = await open(b, DESK, '#ct=epsindb'); await report(p); await sleep(3000);
    await p.evaluate(() => { const T = CHALLENGE.epsindb, q = ctAt({ ra0: T.ra0, dec0: T.dec0, ep: T.ep, pmra: T.pmra, pmdec: T.pmdec }, S.eps[0].t0); spectrumAt(q[0], q[1], { name: 'Epsilon Indi B' }); });
    const ok = await until(p, () => !!document.querySelector('#card .specsvg') && !/Reading \d+ of/.test(document.getElementById('card').innerText), 400000); await sleep(3000);
    await shot(p, '33-spectrum', 'Spectrum on the fly (~100 colours), Epsilon Indi B'); log('spectrum', ok); await p.close();
  },
  async planetx(b) {
    const p = await open(b, DESK, '#ex=proof'); await report(p); await sleep(3000);
    await p.evaluate(() => { const a = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Advanced'); if (a) a.click(); });
    await sleep(1000); await mode(p, 'px'); await sleep(1500);
    await p.evaluate(() => document.getElementById('pxgo').click());
    await until(p, () => document.getElementById('pxt').innerText.trim().length > 20, 120000); await sleep(4000);
    await shot(p, '40-hide-planet-x', 'Hide Planet X'); await p.close();
  },
  async tests(b) {
    const p = await open(b, DESK, '#ct=barnard'); await p.evaluate(() => { localStorage.clear(); location.reload(); }); await sleep(2000); await report(p); await sleep(2000);
    await p.evaluate(() => document.getElementById('tb').click()); await sleep(2500);
    await shot(p, '41-scorecard', 'Tested drawer: how far you can trust it');
    const ok = await p.evaluate(() => { const h = [...document.querySelectorAll('#tdrawer h2, #tdrawer h3, #tdrawer summary, #tdrawer b')].find(e => /false alarm/i.test(e.textContent)); if (!h) return false; h.scrollIntoView({ block: 'start' }); return true; });
    await sleep(1500); if (ok) await shot(p, '42-false-alarm-test', 'False-alarm test'); log('false alarm heading', ok); await p.close();
  },
  async example(b) {
    const p = await open(b, DESK, '#ex=proof'); await report(p); await sleep(6000); await shot(p, '44-known-asteroid', 'Known asteroid example (proof card)'); await p.close();
  },
  async game(b) { const p = await open(b, DESK, ''); await sleep(3000); await p.evaluate(() => document.querySelector('[data-try=game]').click()); await until(p, () => location.hash === '#play', 240000); await sleep(4000); await shot(p, '50-game', 'Find the asteroid (game)'); await p.close(); },
  async tour(b) { const p = await open(b, DESK, '#tour'); await sleep(7000); await shot(p, '51-tour', 'Guided story with narration'); await p.close(); },
  async pages(b) {
    for (const [u, n] of [['tools.html', '52-tools-page'], ['about.html', '53-about-page']]) { const p = await open(b, { ...DESK, height: 900 }, u); await sleep(2500); await shot(p, n); await p.close(); }
  },
  async phone(b) {
    let p = await open(b, PHONE, ''); await p.evaluate(() => { localStorage.clear(); location.reload(); }); await sleep(4000); await shot(p, '60-phone-landing', 'Phone: start page'); await p.close();
    p = await open(b, PHONE, '#ct=epsindb'); await report(p); await sleep(4000); await shot(p, '61-phone-target', 'Phone: Epsilon Indi B'); await p.close();
  },
};

(async () => {
  const b = await puppeteer.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, fn] of Object.entries(jobs)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const t0 = Date.now(); log('job', name);
    try { await fn(b); } catch (e) { log('JOB FAILED', name, String(e.message).slice(0, 160)); }
    log('job', name, 'took', Math.round((Date.now() - t0) / 1000) + 's');
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(done, null, 1));
  await b.close(); log('all done', done.length, 'shots');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
