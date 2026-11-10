'use strict';
// The guided tour must run end to end on the shipped demo-cache (no IRSA): 10 chapters (v0.19), the real example loads by
// chapter 5, chapter 6 names the real asteroid, chapter 9 reads its numbers from scorecard.json. Desktop and phone.
// v0.19: the same story and the guide in Tamil (#tour&lang=ta, and the language buttons), intro included.
// Run: node test/tour.e2e.js   (SHOT=prefix saves a screenshot per chapter)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-tour-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/scorecard.json'), 'utf8'));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    for (const [name, vp] of [['desk', { width: 1400, height: 880 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
      page.setDefaultTimeout(180000);   // the headless sandbox CPU is slow while the 24 example images decode
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('  [console]', m.type(), m.text().slice(0, 200)); });
      await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base + '/'); await page.waitForSelector('#intro .tourb');
      // v0.14: a fresh visit opens on the WHOLE sky, with 2MASS as the base sky
      assert.deepStrictEqual(await page.evaluate(() => [S.al.getFov()[0], document.getElementById('survey').value]), [360, 'P/2MASS/color'], 'opens on the whole sky in 2MASS');
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}_${name}_0intro.png` });
      await page.click('#intro .tourb');
      await page.click('#tour [data-a=pause]');   // the test steps with Next, so the auto-advance does not race it
      const texts = [];
      for (let i = 0; i < 10; i++) {
        await page.waitForFunction(n => document.querySelector('#tour .tnum').textContent.startsWith(n + ' /'), i + 1);
        if (i === 4) await page.waitForFunction(() => S.report, null, { timeout: 120000 });
        if (i === 8) await page.waitForFunction(() => /fake planets/.test(document.querySelector('#tour .tx').textContent));   // the slow sandbox CPU: wait for the scorecard text, not a fixed time
        await page.waitForTimeout(i === 4 ? 900 : 1200);
        const t = await page.textContent('#tour .tcard'); texts.push(t.replace(/\s+/g, ' '));
        if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}_${name}_${i + 1}.png` });
        if (i < 9) await page.click('#tour [data-a=next]');
      }
      console.log(texts.map((t, i) => `  ${name} ${i + 1}: ${t.slice(0, 150)}`).join('\n'));
      assert.ok(/1846/.test(texts[0]) && /Neptune/.test(texts[0]) && /illustration/.test(texts[0]), 'chapter 1: Neptune');
      assert.ok(/1930/.test(texts[1]) && /Pluto/.test(texts[1]), 'chapter 2: Pluto');
      assert.ok(/2016/.test(texts[2]) && /Planet Nine/.test(texts[2]) && /hypothesis/.test(texts[2]), 'chapter 3: Planet Nine, a hypothesis');
      assert.ok(/found \d+ SPHEREx images .* downloaded the \d+ best/.test(texts[4]), 'chapter 5 waits for the real run: ' + texts[4]);
      assert.ok(/Lindbloom/.test(texts[5]), 'chapter 6 names the real asteroid: ' + texts[5]);
      assert.ok(/Find the asteroid/.test(texts[6]), 'chapter 7: the game');
      assert.ok(texts[8].includes(sc.summary.fakes.toLocaleString('en-US')) && texts[8].includes(`${sc.summary.at300.found} of ${sc.summary.at300.of}`), 'chapter 9 numbers from scorecard.json: ' + texts[8]);
      assert.strictEqual(await page.evaluate(() => S.mode), 'px');
      await page.click('#tour [data-a=next]');   // "Start exploring" ends it
      assert.ok(await page.evaluate(() => document.getElementById('tour').hidden && !Tour.on), 'tour closes');

      // Guide: every tool, one by one. Each step has What + How and lights up its tool (except the first and last).
      await page.goto(base + '/?guide-test=1');   // a new document: a still-running story run cannot rewrite its hash (a race seen once)
      await page.waitForSelector('#intro [data-guide]');
      await page.click('#intro [data-guide]');
      const n = await page.evaluate(() => document.querySelectorAll('#tour .tjump option').length), seen = [];
      for (let i = 0; i < n; i++) {
        await page.waitForFunction(k => document.querySelector('#tour .tnum').textContent.startsWith(k + ' /'), i + 1);
        await page.waitForFunction(() => !/Loading the real example/.test(document.querySelector('#tour .tnote').hidden ? '' : document.querySelector('#tour .tnote').textContent));
        await page.waitForTimeout(700);
        const g = await page.evaluate(() => ({ t: document.querySelector('#tour .tt').textContent, w: document.querySelector('#tour .tgw').textContent, h: document.querySelector('#tour .tgh').textContent, lit: document.querySelector('#tour .tspot').classList.contains('on') }));
        assert.ok(g.w.length > 20 && g.h.length > 10, 'guide step has What and How: ' + g.t);
        if (i > 0 && i < n - 1) assert.ok(g.lit, 'guide step lights up its tool: ' + g.t);
        seen.push(g.t);
        if (process.env.SHOT && /Whole sky|Blink|Hide Planet X|Result card|Bottom bar|Base sky/.test(g.t)) await page.screenshot({ path: `${process.env.SHOT}_${name}_g${String(i + 1).padStart(2, '0')}.png` });
        if (i < n - 1) await page.click('#tour [data-a=next]');
      }
      console.log(`  ${name} guide (${n} steps): ${seen.join(' · ')}`);
      assert.ok(n >= 20, 'guide covers every tool: ' + n);
      await page.close();

      // Tamil: the story from a #tour&lang=ta link, the intro, and switching back to English
      const tp = await browser.newPage({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
      tp.setDefaultTimeout(180000); tp.on('pageerror', e => errors.push(name + ' ta: ' + e.message));
      await tp.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await tp.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await tp.goto(base + '/#tour&lang=ta');
      await tp.waitForFunction(() => window.Tour && Tour.on && document.querySelector('#tour .tnum').textContent.startsWith('1 /'));
      await tp.click('#tour [data-a=pause]');
      const ta = await tp.evaluate(() => ({ tt: document.querySelector('#tour .tt').textContent, tx: document.querySelector('#tour .tx').textContent, next: document.querySelector('#tour [data-a=next]').textContent,
        lang: document.getElementById('tour').lang, hl: document.querySelector('#intro .hl').textContent, introLang: document.getElementById('intro').lang, pic: document.querySelector('#tour .tpd').textContent }));
      const tamil = s => /[\u0B80-\u0BFF]/.test(s);
      assert.ok(tamil(ta.tt) && tamil(ta.tx) && /1846/.test(ta.tx) && tamil(ta.next) && ta.lang === 'ta', 'story in Tamil: ' + ta.tt);
      assert.ok(tamil(ta.hl) && ta.introLang === 'ta' && tamil(ta.pic), 'intro and picture label in Tamil');
      for (let i = 1; i < 6; i++) { if (i === 5) await tp.waitForFunction(() => S.report && S.inside, null, { timeout: 120000 }); await tp.click('#tour [data-a=next]'); await tp.waitForFunction(k => document.querySelector('#tour .tnum').textContent.startsWith(k + ' /'), i + 1); }
      await tp.waitForFunction(() => S.report && /லிண்ட்ப்ளூம்|Lindbloom/.test(document.querySelector('#tour .tx').textContent));
      const ch6 = await tp.textContent('#tour .tx');
      assert.ok(tamil(ch6) && /Lindbloom/.test(ch6), 'chapter 6 in Tamil names the real asteroid: ' + ch6);
      if (process.env.SHOT) await tp.screenshot({ path: `${process.env.SHOT}_${name}_ta6.png` });
      await tp.selectOption('#tour select[data-lang]', 'en');
      const en = await tp.evaluate(() => ({ tx: document.querySelector('#tour .tx').textContent, hl: document.querySelector('#intro .hl').textContent, stored: localStorage.getItem('arcnave.lang') }));
      assert.ok(/Lindbloom/.test(en.tx) && !/[\u0B80-\u0BFF]/.test(en.tx) && /Find what moves/.test(en.hl) && en.stored === 'en', 'switched back to English');
      // the guide in Tamil: every step has Tamil What + How
      await tp.selectOption('#tour select[data-lang]', 'ta');
      await tp.evaluate(() => Tour.start('guide'));
      const gn = await tp.evaluate(() => document.querySelectorAll('#tour .tjump option').length);
      for (let i = 0; i < gn; i++) {
        await tp.waitForFunction(k => document.querySelector('#tour .tnum').textContent.startsWith(k + ' /'), i + 1);
        const g = await tp.evaluate(() => [document.querySelector('#tour .tt').textContent, document.querySelector('#tour .tgw').textContent, document.querySelector('#tour .tgh').textContent, document.querySelector('#tour .tg dt').textContent]);
        assert.ok(g.every(tamil), 'guide step in Tamil: ' + g[0]);
        if (i < gn - 1) await tp.click('#tour [data-a=next]');
      }
      console.log(`  ${name} Tamil: story "${ta.tt}", ${gn} guide steps in Tamil, switch back to English ok`);
      // v0.20: Hindi and Spanish from the intro picker; nothing left untranslated; the Listen button
      const miss = await tp.evaluate(() => Tour.missing());
      assert.deepStrictEqual(miss, { ta: [], hi: [], es: [] }, 'every sentence translated: ' + JSON.stringify(miss).slice(0, 400));
      await tp.evaluate(() => Tour.end());
      for (const [l, re, word] of [['hi', /[\u0900-\u097F]/, 'पूरा आकाश'], ['es', /ñ|á|é|í|ó|ú|¿/, 'Todo el cielo']]) {
        await tp.evaluate(() => { const i = document.getElementById('intro'); i.hidden = false; document.body.classList.add('intro'); });
        await tp.selectOption('#intro select[data-lang]', l);
        const hl = await tp.textContent('#intro .hl'); assert.ok(hl.includes(word), l + ' intro: ' + hl);
        await tp.click('#intro .tourb'); await tp.waitForFunction(() => Tour.on); await tp.click('#tour [data-a=pause]');
        for (let i = 1; i < 6; i++) { if (i === 5) await tp.waitForFunction(() => S.report && S.inside, null, { timeout: 120000 }); await tp.click('#tour [data-a=next]'); await tp.waitForFunction(k => document.querySelector('#tour .tnum').textContent.startsWith(k + ' /'), i + 1); }
        const t6 = await tp.textContent('#tour .tx');
        assert.ok(re.test(t6) && /Lindbloom/.test(t6), l + ' chapter 6: ' + t6);
        // Listen: the button is there; with or without a voice for the language nothing breaks
        const vb = await tp.evaluate(() => { const b = document.querySelector('#tour [data-a=voice]'); return { hidden: b.hidden, text: b.textContent }; });
        if (!vb.hidden) { await tp.click('#tour [data-a=voice]'); await tp.waitForTimeout(400);
          const sp = await tp.evaluate(() => ({ on: Tour.speech.on, note: document.querySelector('#tour .tnote').hidden ? '' : document.querySelector('#tour .tnote').textContent }));
          assert.ok(sp.on, 'listen switched on'); console.log(`  ${name} ${l}: Listen on (${sp.note ? 'no voice here: ' + sp.note.slice(0, 50) : 'speaking'})`);
          await tp.click('#tour [data-a=voice]'); }
        if (process.env.SHOT) await tp.screenshot({ path: `${process.env.SHOT}_${name}_${l}6.png` });
        await tp.evaluate(() => Tour.end());
      }
      await tp.close();
    }
    assert.deepStrictEqual(errors, [], errors.join('\n'));
    console.log('\nTOUR E2E passed (whole-sky start in 2MASS; story: 10 chapters, real example, scorecard numbers; guide: every tool with What + How; desktop and phone; story and guide also in Tamil, Hindi, Spanish; Listen)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
