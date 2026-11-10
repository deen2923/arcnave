'use strict';
// v0.26: #prewarm runs the agents on a list of fields one after another and reports each. Here on the shipped demo field
// (no downloads). Run: node test/prewarm.e2e.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-prewarm-'));
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},
 gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(300000);
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/#prewarm&fields=189.957,-4.182;999,0`);
    await page.waitForFunction(() => window.__prewarm);
    const r = await page.evaluate(() => ({ out: window.__prewarm, stat: document.getElementById('stat').textContent }));
    assert.strictEqual(r.out.length, 1, 'the bad field (RA 999) is dropped');
    assert.ok(r.out[0].report && r.out[0].images === 24 && !r.out[0].error, JSON.stringify(r.out));
    assert.ok(/Prewarm done: 1 of 1/.test(r.stat) && /export-demo-cache/.test(r.stat), r.stat);
    console.log(`  ${r.stat.slice(0, 120)}`);
    console.log('\nPREWARM E2E passed');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
