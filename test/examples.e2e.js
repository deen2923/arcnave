'use strict';
// The two one-click examples must open from the shipped demo-cache alone: empty cache folder, no IRSA, no SkyBoT.
// Run: node test/examples.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skyshift-ex-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
const seeded = server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  assert.ok(seeded >= 30, 'demo-cache copied: ' + seeded);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  const sizes = () => ['cutouts', 'api'].map(s => fs.readdirSync(path.join(TMP, s)).length).join('/');
  const before = sizes();
  try {
    for (const [id, want] of [['proof', /Confirmed known asteroid|Lindbloom/], ['false', /Likely artefact/]]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
      page.on('pageerror', e => errors.push(id + ': ' + e.message));
      await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base + '/'); await page.waitForSelector('#intro [data-ex]');
      await page.click(`#intro [data-ex="${id}"]`);
      await page.waitForFunction(() => S.report, null, { timeout: 120000 });
      await page.waitForFunction(() => !document.getElementById('card').hidden, null, { timeout: 20000 });
      const card = await page.textContent('#card'); console.log(`  ${id}: card = ${card.replace(/\s+/g, ' ').slice(0, 140)}`);
      assert.ok(want.test(card), id + ' card: ' + card.slice(0, 300));
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '_' + id + '.png' });
      await page.close();
    }
    assert.strictEqual(sizes(), before, 'no new downloads: ' + before + ' -> ' + sizes());
    assert.deepStrictEqual(errors, [], errors.join('\n'));
    console.log('\nEXAMPLES E2E passed (both open from demo-cache, ' + before + ' cached files, nothing downloaded)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
