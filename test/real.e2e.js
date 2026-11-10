'use strict';
// The whole app in headless Chromium on REAL SPHEREx data: the two fixture cutouts (test/fixtures) are served for the
// cutout route, and the archive search returns those two images with their real IRSA footprints. Only Aladin (sky tiles)
// and SkyBoT are stubbed. Checks what a visitor sees: data check, real wavelengths, coverage, alignment, few changes.
// Run: node test/real.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), path = require('path');
const server = require('../server');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const FX = path.join(__dirname, 'fixtures'), meta = JSON.parse(fs.readFileSync(path.join(FX, 'real_pair.json'), 'utf8'));
const img = (k, id, mjd) => ({ url: meta.urls[k].split('?')[0], id, det: 'D4', mjd, lam0: 2.4027, lam1: 3.8473, lam: 3.125, poly: meta.poly[k] });
const images = [img('A', '2025W22_2B_0360_1', 60826.580046), img('B', '2026W23_1A_0287_1', 61193.622481)];
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;

// Scenario 2 data: all 59 real D4 images of this field (3 epochs), with their real footprints. Only two cutouts exist as
// fixtures, so every epoch-1 image is served fixture A and every later image fixture B (headers and pixels are real).
const field = JSON.parse(fs.readFileSync(path.join(FX, 'real_field_d4.json'), 'utf8'));
const allImages = field.images.map(r => ({ url: `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/x/${r.id}D4.fits`, id: r.id, det: 'D4', mjd: r.mjd, lam0: 2.4027, lam1: 3.8473, lam: 3.125, poly: r.poly }));

async function scenario(browser, base, opts) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } }), errors = [];
  const cutoutCalls = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Like a detector whose wavelength map is not built in (D1-D3, D5, D6): the app must learn it from the first cutout.
  if (opts.noBuiltin) await page.route(/\/lib\/wave\.js/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, body: (await resp.text()) + '\nwindow.SkyWave.BUILTIN_TABLES = {};' }); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/127\.0\.0\.1:\d+\/api\//, async route => {
    const u = new URL(route.request().url()), q = Object.fromEntries(u.searchParams);
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) });
    const list = opts.all ? allImages : images;
    if (u.pathname === '/api/spherex/search') return json({ count: list.length, images: list });
    if (u.pathname === '/api/spherex/cutout') {
      const im = list.find(x => x.url === q.url), k = !im ? null : opts.all ? (im.mjd < 61000 ? 'A' : 'B') : im === images[0] ? 'A' : 'B';
      if (im) cutoutCalls.push(im.id);
      return k ? route.fulfill({ status: 200, contentType: 'application/fits', body: fs.readFileSync(path.join(FX, meta.files[k])) }) : json({ error: 'no fixture' }, 404);
    }
    if (u.pathname === '/api/movers') return json({ mjd: +q.mjd, count: 0, items: [] });
    return json({ error: 'unexpected ' + u.pathname }, 404);
  });
  try {
    await page.goto(base + '/#ipe=1');
    await page.waitForSelector('#alist li');
    await page.click('#go');
    await page.fill('#q', `${meta.field.ra.toFixed(5)} ${meta.field.dec.toFixed(5)}`);
    await page.press('#q', 'Enter');
    try { await page.waitForFunction(() => S.report, null, { timeout: +(process.env.WAIT || 120000) }); }
    catch (e) { console.log('  stalled:', JSON.stringify(await page.$$eval('#alist li', els => els.map(x => x.className + ' | ' + x.querySelector('small').textContent))), await page.textContent('#stat'), errors, 'cutouts', cutoutCalls.length); throw e; }
    const states = await page.$$eval('#alist li', els => els.map(e => [e.querySelector('b').firstChild.textContent, e.className.replace('ag ', ''), e.querySelector('small').textContent]));
    console.log(states.map(s => `  ${s[0].padEnd(10)} ${s[1].padEnd(5)} ${s[2]}`).join('\n'));
    const rep = await page.evaluate(() => S.report);
    console.log('  quality:', rep.quality.text);
    console.log('  epochs:', JSON.stringify(rep.epochs.map(e => ({ lam: e.lam, measured: e.lamMeasured, coverage: e.coverage, check: e.predictionCheck, bad: e.badPixels }))));
    assert.deepStrictEqual(states.map(s => s[1]), ['done', 'done', 'done', 'done', 'done']);
    assert.ok(rep.quality && rep.quality.ok && rep.quality.nearMiss <= 2, 'data check should run and pass on real data');
    if (opts.all) {
      // the learned table re-ranked the images: the chosen ones must be the loaded, aligned ones, and colours close
      const ch = await page.evaluate(() => [chosen(0), chosen(S.eps.length - 1)].map(im => ({ id: im.id, pred: geo(im) && geo(im).lam, loaded: !!S.frames.get(im.url), shift: S.frames.get(im.url) && S.frames.get(im.url).shift })));
      console.log('  chosen:', JSON.stringify(ch.map(c => [c.id, c.pred && +c.pred.toFixed(3), c.loaded, c.shift && c.shift.method])), 'cutouts fetched:', cutoutCalls.length);
      assert.strictEqual(rep.epochCount, 3);
      assert.ok(ch.every(c => c.loaded) && ch[0].shift.method === 'reference' && ch[1].shift.method === 'stars', 'final choice loaded and registered');
      assert.ok(Math.abs(ch[0].pred - ch[1].pred) < 0.05, 'predicted colours should match across epochs');
      assert.ok(cutoutCalls.length <= 6, 'too many downloads: ' + cutoutCalls.length);
      assert.ok(/same colour in each epoch|closest colours/.test(states[1][2]));
      assert.deepStrictEqual(errors, [], 'browser errors:\n' + errors.join('\n'));
      console.log('\nREAL-DATA E2E (learned wavelength map, 59 real footprints) passed');
      return;
    }
    assert.ok(rep.candidates.length <= 3, 'changes: ' + rep.candidates.length);
    assert.ok(rep.alignment.method === 'stars' && rep.alignment.starsMatched >= 40 && Math.hypot(rep.alignment.dx, rep.alignment.dy) < 0.1, JSON.stringify(rep.alignment));
    const [e1, e2] = rep.epochs;
    assert.ok(e1.lamMeasured && Math.abs(e1.lam - 3.5804) < 0.002 && Math.abs(e2.lam - 3.8209) < 0.002, 'measured wavelengths');
    assert.ok(e1.predictionCheck.detErrPx < 15 && e2.predictionCheck.detErrPx < 15 && Math.abs(e1.predictionCheck.lamPred - 3.5804) < 0.01, 'footprint prediction');
    assert.ok(e1.coverage > 0.99 && e2.coverage < 0.6, 'coverage');
    assert.ok(e1.badPixels.glitch > 1000, 'bad pixels masked');
    const card = await page.textContent('#card');
    assert.ok(/Data check: passed/.test(card) && /3\.580 µm/.test(card) && /covers \d+%/.test(card), card.slice(0, 400));
    const lab = await page.textContent('#lam');
    assert.ok(/measured in the image/.test(lab) && /Other epoch: 3\.580/.test(lab), lab);
    await page.screenshot({ path: path.join(process.env.E2E_OUT || __dirname, 'real-e2e.png') });
    assert.deepStrictEqual(errors, [], 'browser errors:\n' + errors.join('\n'));
    console.log('\nREAL-DATA E2E passed');
  } catch (e) { console.log('\nREAL-DATA E2E FAILED\n' + (e.stack || e)); process.exitCode = 1; }
  await page.close();
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  if (!process.env.ONLY2) await scenario(browser, base, {});
  await scenario(browser, base, { all: true, noBuiltin: true });
  await browser.close(); server.close();
})();
