'use strict';
// Discovery card (v0.15): from the shipped asteroid example (demo-cache, no network), make the card for the confirmed
// asteroid and for a plain field in Blink, decode the GIFs and check frames, size and the dialog on desktop and phone.
// Run: node test/card.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { decode } = require('./gifdecode');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-card-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const SHOT = process.env.SHOT;
async function gifOf(page) {
  const b64 = await page.evaluate(async () => { const r = await fetch(document.getElementById('dcdimg').src), a = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); });
  return decode(Buffer.from(b64, 'base64'));
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    for (const vp of [{ width: 1400, height: 880, name: 'desktop' }, { width: 390, height: 844, name: 'phone', isMobile: true, hasTouch: true }]) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
      page.setDefaultTimeout(180000);
      page.on('pageerror', e => errors.push(vp.name + ': ' + e.message));
      page.on('console', m => { if (/\[card\]/.test(m.text())) console.log('  ' + vp.name + ' ' + m.text()); });
      await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base + '/'); await page.waitForSelector('#intro [data-ex]', { state: 'attached' });
      await page.evaluate(() => runExample('proof'));
      await page.waitForFunction(() => S.report && S.inside && S.inside.asteroids.some(a => a.confirmed));
      // 1) the confirmed asteroid
      await page.evaluate(() => focusExample('asteroid'));
      await page.evaluate(() => [...document.querySelectorAll('#card .cardb')][0].click());
      await page.waitForFunction(() => document.getElementById('dcd').open && CARD.last);
      const last = await page.evaluate(() => CARD.last), g = await gifOf(page);
      console.log(`  ${vp.name} asteroid: ${last.plan.title}, ${g.frames.length} frames, ${(last.size / 1024).toFixed(0)} kB, ${last.name}`);
      assert.ok(/Lindbloom/.test(last.plan.title), last.plan.title);
      assert.ok(/Known asteroid, confirmed/.test(last.plan.badge), last.plan.badge);
      assert.strictEqual(g.w, 540); assert.strictEqual(g.hgt, 790); assert.strictEqual(g.loop, 0);
      assert.ok(g.frames.length >= 3 && g.frames.length === last.plan.frames, 'frames ' + g.frames.length);
      assert.ok(last.size < 3.5 * 1024 * 1024, 'size ' + last.size);
      // frames really differ (the sky patch changes between images) and the header stays identical
      const diffPix = (a, b, y0, y1) => { let d = 0; for (let i = y0 * 540; i < y1 * 540; i++) if (g.pal[a.idx[i]].join() !== g.pal[b.idx[i]].join()) d++; return d; };
      assert.ok(diffPix(g.frames[0], g.frames[1], 112, 560) > 2000, 'image area changes between frames');
      assert.strictEqual(diffPix(g.frames[0], g.frames[1], 0, 70), 0, 'header identical in every frame');
      assert.ok(/SPHEREx/.test(await page.inputValue('#dcdtxt')) && /#NASASpaceApps/.test(await page.inputValue('#dcdtxt')), 'post text');
      assert.ok(/\.gif$/.test(await page.getAttribute('#dcddl', 'download')));
      const box = await page.evaluate(() => { const r = document.getElementById('dcd').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
      assert.ok(box.l >= 0 && box.r <= vp.width && box.t >= 0 && box.b <= vp.height + 1, 'dialog fits the screen ' + JSON.stringify(box));
      if (SHOT) { await page.screenshot({ path: `${SHOT}_${vp.name}_dialog.png` }); fs.writeFileSync(`${SHOT}_${vp.name}_asteroid.gif`, Buffer.from(await page.evaluate(async () => { const a = new Uint8Array(await (await fetch(document.getElementById('dcdimg').src)).arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); }), 'base64')); }
      await page.click('#dcdx'); assert.strictEqual(await page.evaluate(() => document.getElementById('dcd').open), false);
      // 2) no object picked: the field in Blink, from the header button
      await page.evaluate(() => { S.sel = null; setMode('blink'); if (window.matchMedia('(max-width:700px)').matches && typeof phoneSheet === 'function') phoneSheet('panel'); });
      await page.evaluate(() => document.getElementById('dcard').click());
      await page.waitForFunction(() => document.getElementById('dcd').open && CARD.last && /sky over time/.test(CARD.last.plan.title));
      const l2 = await page.evaluate(() => CARD.last), g2 = await gifOf(page);
      console.log(`  ${vp.name} field: ${g2.frames.length} frames, ${(l2.size / 1024).toFixed(0)} kB`);
      assert.ok(g2.frames.length >= 2 && g2.frames.length <= 14, 'field frames ' + g2.frames.length);
      if (SHOT) fs.writeFileSync(`${SHOT}_${vp.name}_field.gif`, Buffer.from(await page.evaluate(async () => { const a = new Uint8Array(await (await fetch(document.getElementById('dcdimg').src)).arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); }), 'base64'));
      await page.close();
    }
    assert.deepStrictEqual(errors, [], errors.join('\n'));
    console.log('\nCARD E2E passed');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
