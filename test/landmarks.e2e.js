'use strict';
// v0.14.3: every whole-sky landmark opens its preview (one image per sky pass) from the shipped demo-cache, without IRSA.
// The other images of each field are NOT shipped (size); they come from IRSA when online. Run: node test/landmarks.e2e.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-lm-'));
process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_RETRIES = '0';
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:()=>[100,100],pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch();
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(120000);
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(base + '/'); await page.waitForFunction(() => typeof LANDMARKS !== 'undefined' && S.al);
    const names = await page.evaluate(() => LANDMARKS.map(m => m.name));
    for (const name of names) {
      const t0 = Date.now();
      await page.evaluate(n => { const m = LANDMARKS.find(x => x.name === n); runAgents({ ra: m.ra, dec: m.dec, label: m.name }); }, name);
      await page.waitForFunction(n => { const m = LANDMARKS.find(x => x.name === n); return S.field && Math.abs(S.field.ra - m.ra) < 1e-3 && S.eps.length && S.eps.every((_, i) => rawOf(i)); }, name);
      const r = await page.evaluate(() => ({ E: S.eps.length, n: S.images.length }));
      console.log(`  ${name}: preview of ${r.E} sky passes (${r.n} images in the archive) in ${((Date.now() - t0) / 1000).toFixed(1)} s, no IRSA`);
      assert.ok(r.E >= 2, name + ' has at least two passes to compare');
    }
    console.log('\nLANDMARKS E2E passed (every whole-sky landmark previews from demo-cache)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
