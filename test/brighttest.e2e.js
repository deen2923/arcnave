'use strict';
// v0.31: #brighttest makes real stars brighter by known factors in the last pass and checks the Changes view catches them. Here on the shipped demo field (no downloads). Run: node test/brighttest.e2e.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-bright-'));
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
    await page.goto(`http://127.0.0.1:${server.address().port}/#brighttest&test=1`);
    await page.waitForFunction(() => window.__brighttest);
    const r = await page.evaluate(() => ({ out: window.__brighttest, stat: document.getElementById('stat').textContent }));
    const f = r.out[0];
    assert.strictEqual(f.status, 'ok', JSON.stringify(f).slice(0, 300));
    const g = x => f.byGain.find(q => q.gain === x);
    console.log(JSON.stringify(f.byGain), f.stars.length, 'stars'); console.log(JSON.stringify(f.stars.map(s => [s.snr, s.caught.map(Number).join('')])));
    assert.ok(g(1).caught <= 1, 'unchanged stars reported: ' + g(1).caught);
    assert.ok(g(3).caught >= 0.8 * g(3).of, 'tripled stars caught: ' + g(3).caught);
    assert.ok(/Brightness test done: 1 of 1/.test(r.stat), r.stat);
    console.log('\nBRIGHTTEST E2E passed');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
