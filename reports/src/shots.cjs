// Report screenshots from v0.56 on port 8084: landing sections, the 5 NASA targets, films, tools page, phone.
const path = require('path'), fs = require('fs');
const puppeteer = require('C:/Users/Admin/AppData/Local/Temp/lh/node_modules/puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DESK = { width: 1440, height: 860 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function page(b, view, url) {
  const p = await b.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.setViewport(view);
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('arcnave.coach', 'done'); localStorage.setItem('arcnave.seen', '1'); } catch { } });
  await p.goto('http://localhost:8084/' + url, { waitUntil: 'domcontentloaded' });
  return p;
}
async function waitReport(p, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await p.evaluate(() => typeof S !== 'undefined' && !!S.report).catch(() => false)) return true; await sleep(1000); }
  return false;
}
async function closeOverlays(p) {
  await p.evaluate(() => { document.querySelectorAll('.coach,.qs,#coach,#qstart').forEach(e => e.remove?.()); }).catch(() => { });
}
const jobs = {
  async landing(b) {
    const p = await page(b, { ...DESK, height: 900 }, '');
    await sleep(2500); await p.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    for (const [id, sel] of [['how', '#how, .lp-steps'], ['features', '#features, #lp-feat, .lp-grid'], ['targets', '#lp-targets'], ['tested', '#tested, #lp-tested'], ['modes', '.lp-modes'], ['limits', '.lp-limits']]) {
      const ok = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const sec = e.closest('section') || e; sec.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); return true; }, sel);
      if (!ok) { log('landing: no', sel); continue; }
      await sleep(900); await p.screenshot({ path: path.join(OUT, `landing-${id}.png`) });
    }
    log('landing done', p.errs.join(' | ') || 'no errors'); await p.close();
  },
  async tools(b) {
    const p = await page(b, { ...DESK, height: 900 }, 'tools.html'); await sleep(2500);
    await p.screenshot({ path: path.join(OUT, 'tools-page.png') }); log('tools done'); await p.close();
  },
  async targets(b) {
    for (const ct of ['barnard', 'epsindb', 'wise0855', 'rwaur', 'rdra']) {
      const p = await page(b, DESK, '#ct=' + ct);
      const ok = await waitReport(p); await sleep(4000); await closeOverlays(p);
      await p.screenshot({ path: path.join(OUT, `target-${ct}.png`) });
      log(ct, 'report', ok, p.errs.join(' | ') || 'no errors');
      if (['barnard', 'epsindb', 'wise0855'].includes(ct)) {
        const started = await p.evaluate(() => { if (typeof movieStart === 'function') { movieStart(); return 'fn'; } const x = document.getElementById('mvb'); if (x) { x.click(); return 'btn'; } return null; });
        const t1 = Date.now(); let on = false;
        while (Date.now() - t1 < 180000) { on = await p.evaluate(() => typeof MOVIE !== 'undefined' && MOVIE.on && !!MOVIE.timer).catch(() => false); if (on) break; await sleep(1000); }
        await sleep(5200); await p.screenshot({ path: path.join(OUT, `film-${ct}.png`) });
        await sleep(2900); await p.screenshot({ path: path.join(OUT, `film-${ct}-b.png`) });
        log(ct, 'film', started, on, Math.round((Date.now() - t1) / 1000) + 's');
      }
      await p.close();
    }
  },
  async phone(b) {
    const p = await page(b, PHONE, '#ct=epsindb'); await waitReport(p); await sleep(4000); await closeOverlays(p);
    await p.screenshot({ path: path.join(OUT, 'phone-epsindb.png') });
    const q = await page(b, PHONE, ''); await sleep(2500); await q.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    await q.screenshot({ path: path.join(OUT, 'phone-landing.png') }); log('phone done'); await p.close(); await q.close();
  },
};
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [k, f] of Object.entries(jobs)) { if (ONLY && !ONLY.includes(k)) continue; try { await f(b); } catch (e) { log(k, 'FAILED', e.message); } }
  await b.close();
})();
