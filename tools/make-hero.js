'use strict';
// Makes public/hero-blink.gif: the real SPHEREx frames of the shipped asteroid example (3865 Lindbloom, demo-cache),
// cropped around the asteroid, for the intro's blink plate. Prints the facts for its caption. Run: node tools/make-hero.js
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-hero-'));
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},
 gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(300000);
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForSelector('#intro .tourb');
    await page.click('#intro [data-ex=proof]');
    await page.waitForFunction(() => S.report && S.sel && S.sel.ast);
    const out = await page.evaluate(() => {
      const plan = cardPlan(), W = 360, H = Math.round(360 * 448 / 500);
      const big = document.createElement('canvas'); big.width = CARD.W; big.height = CARD.H; const g = big.getContext('2d', { willReadFrequently: true });
      const sm = document.createElement('canvas'); sm.width = W; sm.height = H; const s = sm.getContext('2d', { willReadFrequently: true });
      s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high';
      const frames = plan.frames.map((f, i) => { drawCardFrame(g, plan, i); s.clearRect(0, 0, W, H); s.drawImage(big, CARD.X, CARD.Y, CARD.S, 448, 0, 0, W, H);
        return { rgba: s.getImageData(0, 0, W, H).data, delay: i === plan.frames.length - 1 ? 1300 : 700 }; });
      const gif = SkyGif.encode({ width: W, height: H, frames });
      let bin = ''; for (let i = 0; i < gif.length; i++) bin += String.fromCharCode(gif[i]);
      const mj = plan.frames.map(f => f.mjd);
      return { b64: btoa(bin), W, H, n: frames.length, title: plan.title, fact: plan.fact, ra: plan.ra, dec: plan.dec,
        t0: new Date((Math.min(...mj) - 40587) * 864e5).toISOString(), t1: new Date((Math.max(...mj) - 40587) * 864e5).toISOString(),
        lam: plan.frames.map(f => +f.lam.toFixed(2)) };
    });
    const file = path.join(__dirname, '../public/hero-blink.gif');
    fs.writeFileSync(file, Buffer.from(out.b64, 'base64'));
    delete out.b64; console.log(JSON.stringify(out, null, 1)); console.log((fs.statSync(file).size / 1024).toFixed(0) + ' kB written to public/hero-blink.gif');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
