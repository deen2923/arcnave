'use strict';
// v0.15.2 wait indicator + share-preview tags + About page. The archive is made slow on purpose (search 3 s, each cutout
// 2.5 s): the indicator must say what it waits for, count images, then go away. With no delay it must never show.
// Run: node test/wait.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-wait-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    // share preview tags carry this site's absolute address; the image and icons are served
    const html = await (await fetch(base + '/')).text();
    const og = (html.match(/property="og:image" content="([^"]+)"/) || [])[1];
    assert.strictEqual(og, base + '/og.jpg', 'og:image ' + og);
    assert.ok(!html.includes('%ORIGIN%'), 'placeholder replaced');
    for (const [f, type] of [['/og.jpg', 'image/jpeg'], ['/icon.svg', 'image/svg+xml'], ['/icon-180.png', 'image/png'], ['/manifest.webmanifest', 'application/manifest+json'], ['/about.html', 'text/html']]) {
      const r = await fetch(base + f); assert.strictEqual(r.status, 200, f); assert.ok(r.headers.get('content-type').startsWith(type), f + ' ' + r.headers.get('content-type'));
    }
    const pub = await (await fetch(base + '/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'arcnave.example.org' } })).text();
    assert.ok(pub.includes('content="https://arcnave.example.org/og.jpg"'), 'behind a proxy the public address is used');
    const evil = await (await fetch(base + '/', { headers: { 'x-forwarded-host': 'x"><script>alert(1)</script>' } })).text();
    assert.ok(!evil.includes('<script>alert(1)'), 'a forged host header cannot inject markup');

    // About page renders the scorecard
    const ab = await browser.newPage({ viewport: { width: 390, height: 844 } });
    ab.on('pageerror', e => errors.push('about: ' + e.message));
    await ab.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ab.goto(base + '/about.html');
    await ab.waitForFunction(() => document.querySelectorAll('#sct tbody tr').length === 18);
    const statsTxt = await ab.textContent('#stats'); console.log('  about stats: ' + statsTxt.replace(/\s+/g, ' ').trim());
    assert.ok(/fake planets/.test(statsTxt) && /1000 AU/.test(statsTxt));
    assert.ok(await ab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone');
    if (process.env.SHOT) await ab.screenshot({ path: process.env.SHOT + '_about.png', fullPage: true });
    await ab.close();

    const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    let slow = true;
    await page.route(/\/api\/spherex\/(search|cutout)/, async r => { if (slow) await sleep(/search/.test(r.request().url()) ? 3000 : 2500); r.continue(); });
    await page.goto(base + '/'); await page.waitForFunction(() => typeof runAgents === 'function' && S.al);
    const seen = new Set(); let sawBar = false, shot = false;
    const run = page.evaluate(() => runAgents({ ra: 189.957, dec: -4.182, label: 'test' }, { skipNav: true }));
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const st = await page.evaluate(() => ({ vis: !document.getElementById('wait').hidden, h: document.getElementById('waith').textContent, t: document.getElementById('waitt').textContent, bar: !document.getElementById('waitbar').hidden, done: !!S.report }));
      if (st.vis) { seen.add(st.h.replace(/\d+ of \d+.*/, 'N of M')); if (st.bar) sawBar = true; if (!shot && /Deeper stacks/.test(st.h) && process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '_wait.png' }); shot = true; } }
      if (st.done) break;
      await sleep(400);
    }
    await run;
    console.log('  phases seen: ' + [...seen].join(' | '));
    assert.ok([...seen].some(h => /Asking NASA's archive/.test(h)), 'search phase shown');
    assert.ok([...seen].some(h => /first image of each sky pass|Deeper stacks/.test(h)), 'download phase shown');
    assert.ok(sawBar, 'progress bar shown');
    assert.strictEqual(await page.evaluate(() => document.getElementById('wait').hidden), true, 'gone when finished');

    // everything cached and no delay: the indicator never appears
    slow = false;
    await page.evaluate(() => { window.__waitSeen = false; new MutationObserver(() => { if (!document.getElementById('wait').hidden) window.__waitSeen = true; }).observe(document.getElementById('wait'), { attributes: true }); });
    await page.evaluate(() => runAgents({ ra: 189.957, dec: -4.182, label: 'again' }, { skipNav: true }));
    assert.strictEqual(await page.evaluate(() => window.__waitSeen), false, 'never flashes when everything is cached');
    // SkyBoT not answering: the run still finishes, and says plainly that nothing could be named
    await page.route(/\/api\/movers/, async r => { await sleep(1000); r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SkyBoT (the known-object service) is not answering right now. Try again in a few minutes.' }) }); });
    const t1 = Date.now();
    await page.evaluate(() => runAgents({ ra: 189.957, dec: -4.182, label: 'no skybot' }, { skipNav: true }));
    const ana = await page.evaluate(() => S.ag.ana);
    console.log(`  SkyBoT down: finished in ${((Date.now() - t1) / 1000).toFixed(1)} s, Analyst: ${ana.state}: ${ana.msg.slice(-120)}`);
    assert.ok(await page.evaluate(() => !!S.report), 'report written');
    assert.ok(ana.state === 'warn' && /Known-object check not possible/.test(ana.msg), 'Analyst says why');
    assert.deepStrictEqual(errors, [], errors.join('\n'));
    console.log('\nWAIT E2E passed (share tags, About page, wait indicator)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
