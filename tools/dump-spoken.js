'use strict';
// Writes public/audio/texts.json: every caption the tour's Listen button can read, per language, with its file key.
// It runs the real story on the shipped demo cache (so the live numbers are the ones a visitor sees).
// Then tools/make-voices.py records one mp3 per caption. Run: node tools/dump-spoken.js
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-voice-'));
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},
 gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 880 } }); page.setDefaultTimeout(240000);
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForSelector('#intro .tourb');
    await page.click('#intro .tourb'); await page.click('#tour [data-a=pause]');
    for (let i = 1; i < 10; i++) { await page.click('#tour [data-a=next]'); await page.waitForTimeout(300); }   // the last chapters load the example and the scorecard
    await page.waitForFunction(() => S.report && /fake planets/.test(JSON.stringify(Tour.spoken().en)));
    const out = await page.evaluate(() => Tour.spoken());
    fs.writeFileSync(path.join(__dirname, '../public/audio/texts.json'), JSON.stringify(out, null, 1));
    for (const [l, list] of Object.entries(out)) console.log(l, list.length, 'captions,', list.reduce((n, x) => n + x.text.length, 0), 'characters');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
