'use strict';
// v0.24: Listen plays the recorded narration (public/audio/<lang>/<key>.mp3) in Tamil, Hindi, Spanish, English, falls back to
// the device voice when a caption has no recording, and the story waits for the recording to end before the next chapter.
// The recordings are faked here (a 1.5 s tone) through page.route. Run: node test/voice.e2e.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-voice-'));
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},
 gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const until = async (f, ms = 10000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
const TONE = fs.readFileSync(path.join(__dirname, 'fixtures/tone.mp3'));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 880 } }); page.setDefaultTimeout(120000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    // the shipped index.json may be empty (recordings are made on a computer with internet): the test brings its own
    const files = [];
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForSelector('#intro .tourb');
    const all = await page.evaluate(() => Tour.spoken());
    const index = {}; for (const [l, list] of Object.entries(all)) index[l] = list.map(x => x.key).filter((k, i) => !(l === 'es' && i === 0));   // Spanish chapter 1: no recording
    await page.route(/\/audio\/index\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(index) }));
    await page.route(/\/audio\/[a-z]{2}\/[0-9a-f]{8}\.mp3/, r => { files.push(new URL(r.request().url()).pathname); r.fulfill({ contentType: 'audio/mpeg', body: TONE }); });
    for (const l of ['ta', 'hi', 'en']) {
      await page.evaluate(lang => { Tour.end(); Tour.setLang(lang); Tour.start('story'); }, l);
      await page.click('#tour [data-a=voice]');
      await page.waitForFunction(() => Tour.speech.src === 'file' && Tour.speech.busy);
      const want = all[l][0].key;
      await until(() => files.includes(`/audio/${l}/${want}.mp3`));
      assert.ok(files.some(f => f === `/audio/${l}/${want}.mp3`), `${l}: chapter 1 recording requested (${files.slice(-1)})`);
      // the story waits for the recording, then moves on; the reading ends by itself
      await page.waitForFunction(() => !Tour.speech.busy, null, { timeout: 15000 });
      console.log(`  ${l}: chapter 1 played from /audio/${l}/${want}.mp3`);
      await page.click('#tour [data-a=voice]');
    }
    // Spanish chapter 1 has no recording: the device voice or the "no voice" note, never an error
    await page.evaluate(() => { Tour.end(); Tour.setLang('es'); Tour.start('story'); });
    await page.click('#tour [data-a=voice]'); await page.waitForTimeout(800);
    const es = await page.evaluate(() => ({ src: Tour.speech.src, note: document.querySelector('#tour .tnote').hidden ? '' : document.querySelector('#tour .tnote').textContent }));
    assert.ok(es.src === 'device' || /español/.test(es.note), 'es without a recording: device voice or note ' + JSON.stringify(es));
    console.log(`  es chapter 1 without a recording: ${es.src === 'device' ? 'device voice' : 'note: ' + es.note.slice(0, 50)}`);
    // Next while reading: the old recording stops and the next chapter's plays
    await page.click('#tour [data-a=next]');
    assert.ok(await until(() => files.includes(`/audio/es/${all.es[1].key}.mp3`)), 'es chapter 2 recording requested');
    assert.ok(await page.evaluate(() => Tour.speech.src === 'file'), 'es chapter 2 from the file');
    console.log('  es chapter 2 played from its recording after Next');
    await page.evaluate(() => Tour.end()); await page.evaluate(() => Tour.start('guide'));
    assert.ok(await until(() => files.includes(`/audio/es/${all.es[10].key}.mp3`)), 'guide step 1 recording requested');
    console.log('  guide step 1 read from its recording');
    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('\nVOICE E2E passed (recorded narration in ta/hi/en/es, fallback without a recording, Next, guide)');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
