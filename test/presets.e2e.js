'use strict';
// v0.14.2: the three colour presets on the asteroid example open from the shipped demo-cache (no IRSA), every image stays in
// the chosen colour range (one detector), and the preview + report arrive. Run: node test/presets.e2e.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-presets-'));
process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_RETRIES = '0';
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 880 } }); page.setDefaultTimeout(300000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(base + '/#ex=proof');
    await page.waitForFunction(() => S.report);
    for (const [b, det, lo, hi] of [['1.0', 'D1', 0.74, 1.12], ['3.0', 'D4', 2.4, 3.9], ['4.5', 'D6', 4.4, 5.05]]) {
      const t0 = Date.now();
      await page.click(`[data-b="${b}"]`);
      await page.waitForFunction(x => S.report && Math.abs(S.band - x) < 0.01, +b);
      const r = await page.evaluate(() => ({ dets: [...new Set(S.seq.map(x => x.im.det))], lams: S.seq.map(x => lamRank(x.im)), loaded: S.seq.filter(x => S.frames.get(x.im.url)).length, n: S.seq.length, lam0: lamOf(chosen(0)) }));
      console.log(`  ${b} µm: ${r.loaded}/${r.n} images loaded, detectors ${r.dets.join(',')}, ${Math.min(...r.lams).toFixed(2)} to ${Math.max(...r.lams).toFixed(2)} µm, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      assert.deepStrictEqual(r.dets, [det], b + ' stays on one detector');
      assert.ok(r.lams.every(l => l >= lo && l <= hi), b + ' colours in range');
      assert.ok(Math.abs(r.lam0 - +b) < 0.1, b + ' first image at the chosen colour');
      assert.ok(r.loaded >= r.n - 1, b + ' loaded from demo-cache: ' + r.loaded + '/' + r.n);
    }
    assert.deepStrictEqual(errors, [], errors.join('\n'));
    console.log('\nPRESETS E2E passed (Hot stars, Dust & Ice, Cool worlds open from demo-cache, one colour range each)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
