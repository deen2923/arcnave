'use strict';
// "Explained" Changes view (v0.22): on the shipped asteroid example (no network), the default Changes view sorts every
// changed spot into kinds, says it in one sentence, hides glitches on the sky, steps through a kind on each tap, and the
// change card flips between the image and the usual sky. Desktop and phone.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-chg-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const SHOT = process.env.SHOT;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    for (const vp of [{ width: 1400, height: 880, name: 'desktop' }, { width: 390, height: 844, name: 'phone', isMobile: true, hasTouch: true }]) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
      page.setDefaultTimeout(180000); page.on('pageerror', e => errors.push(vp.name + ': ' + e.message));
      await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await page.route(/fonts\.(googleapis|gstatic)\.com|amazonaws/, r => r.abort());
      await page.goto(base + '/'); await page.waitForFunction(() => typeof runExample === 'function');
      await page.evaluate(() => runExample('proof', { focus: null }));
      await page.waitForFunction(() => S.report && S.mode === 'change' && S.chg && document.querySelector('#chgl .chgsum'));
      const v = await page.evaluate(() => ({ cv: S.cv, sum: document.querySelector('#chgl .chgsum').textContent, chips: [...document.querySelectorAll('#chgl .chgk')].map(b => b.querySelector('.kt').textContent),
        by: Object.fromEntries(Object.entries(chgByKind(S.chg)).map(([k, l]) => [k, l.length])), hits: S.hits.filter(x => x.chg).map(x => chgKind(x.chg)) }));
      console.log(`  ${vp.name}: ${v.sum}\n    kinds ${JSON.stringify(v.by)}, chips: ${v.chips.join(' | ')}`);
      assert.strictEqual(v.cv, 'st', 'Explained is the default');
      assert.ok(/SPHEREx images taken over/.test(v.sum) && /detector glitch/.test(v.sum) && /1 known asteroid/.test(v.sum), 'one plain sentence');
      assert.ok(v.by.known >= 1 && v.by.glitch > 0, 'asteroid and glitches sorted');
      assert.ok(v.hits.length > 0 && !v.hits.includes('glitch'), 'glitches hidden on the sky');
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `chg-${vp.name}-all.png`) });
      const panel = () => vp.isMobile ? page.evaluate(() => phoneSheet('panel')) : null;
      // asteroid chip opens its proof card
      await panel();
      await page.click('#chgl .chgk:nth-child(1)');
      assert.ok(/Lindbloom/.test(await page.textContent('#card h3')), 'asteroid card');
      // step through another kind with something in it
      const kind = await page.evaluate(() => ['star', 'other', 'glitch'].find(k => chgByKind(S.chg)[k].length > 1));
      const idx = { star: 2, other: 3, glitch: 4 }[kind];
      await panel(); await page.click(`#chgl .chgk:nth-child(${idx})`);
      const a = await page.evaluate(() => ({ step: CHGW.step[CHGW.show], show: CHGW.show, h3: document.querySelector('#card h3').textContent, flip: !!document.querySelector('#card canvas.chgflip'), hits: S.hits.filter(x => x.chg).map(x => chgKind(x.chg)) }));
      await page.click('#card .chgnext');   // next one of the same kind, from the card
      const b = await page.evaluate(() => CHGW.step[CHGW.show]);
      assert.ok(a.show === kind && a.step === 0 && b === 1 && a.flip, 'steps through ' + kind + ' with a flip picture: ' + JSON.stringify(a));
      await page.waitForTimeout(400);
      assert.ok(a.hits.every(k => k === kind || k !== 'glitch' || kind === 'glitch'), 'only that kind shown');
      const lab1 = await page.textContent('#card .chgfl'); await page.waitForTimeout(1000); const lab2 = await page.textContent('#card .chgfl');
      assert.notStrictEqual(lab1, lab2, 'card picture flips');
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `chg-${vp.name}-${kind}.png`) });
      await panel(); await page.click('#chgl .chgall');
      assert.strictEqual(await page.evaluate(() => CHGW.show), null);
      // the expert views still work
      await panel(); await page.click('[data-cv=im]'); assert.ok(await page.evaluate(() => S.cv === 'im' && !document.querySelector('#chgl .chgsum')));
      await page.close();
    }
    assert.deepStrictEqual(errors, []);
    console.log('\nCHANGES E2E passed (Explained view: kinds, sentence, glitches hidden, step-through, flip card; By epoch / By image still there)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
