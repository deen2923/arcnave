// Landing hero screenshots at several widths (port 8084, v0.56).
const path = require('path'), fs = require('fs');
const puppeteer = require('C:/Users/Admin/AppData/Local/Temp/lh/node_modules/puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEWS = { w1920: { width: 1920, height: 1000 }, w1440: { width: 1440, height: 900 }, w1024: { width: 1024, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [k, v] of Object.entries(VIEWS)) {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.setViewport(v);
    await p.goto('http://localhost:8083/', { waitUntil: 'networkidle2' }); await sleep(2500);
    await p.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    await sleep(800);
    const m = await p.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
      return { h1: r('.lp-h1'), btns: r('.lp-btns'), q: r('.lp-q'), scope: r('.lp-scope'), docW: document.documentElement.scrollWidth, vw: innerWidth, anim: !!document.querySelector('.lpanim') || /gif$/.test(document.getElementById('lpgif').src), film: !!document.getElementById('lpm-film') }; });
    const h = await p.evaluate(() => { const s = document.querySelector('.lp-scope').getBoundingClientRect(); return Math.ceil(s.bottom + scrollY + 40); });
    await p.setViewport({ ...v, height: Math.min(h, 2400) }); await sleep(600); await p.screenshot({ path: path.join(OUT, `hero-${k}.png`) });
    console.log(k, JSON.stringify(m), 'errors:', errs.join(' | ') || 'none');
    await p.close();
  }
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
