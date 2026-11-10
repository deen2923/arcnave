'use strict';
// Several images per epoch (v0.6), end to end in headless Chromium with a synthetic field:
//  - 2 epochs x 6 images ("visits": two 3 minutes apart, the rest days apart), same colour in every slot
//  - "Swiftrock" (V 16.5, known to SkyBoT) moves about 30 px per day, so it is somewhere else at every visit
//  - a hot pixel in one image (must never be reported), a blurred glint in one image only (gone from the stacks)
//  - a source that is new in epoch 2 and present in all its images (a real change between the epoch stacks)
// Run: node test/multi.e2e.js
const assert = require('assert');
const F = require('../lib/fits');
const server = require('../server');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const PXS = 6.15 / 3600, NX = 300;
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
const header = cards => { const s = cards.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80); return s.padEnd(Math.ceil(s.length / 2880) * 2880); };
const wcsCards = [['CTYPE1', 'RA---TAN'], ['CTYPE2', 'DEC--TAN'], ['CRPIX1', 150.5], ['CRPIX2', 150.5], ['CRVAL1', 190], ['CRVAL2', -4], ['CD1_1', -PXS], ['CD1_2', 0], ['CD2_1', 0], ['CD2_2', PXS]];
const ext = (name, fn, extra = []) => {
  const hd = header([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', NX], ['NAXIS2', NX], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', name], ...extra]);
  const data = Buffer.alloc(Math.ceil(NX * NX * 4 / 2880) * 2880);
  for (let i = 0; i < NX * NX; i++) data.writeFloatBE(fn[i], i * 4);
  return Buffer.concat([Buffer.from(hd, 'ascii'), data]);
};
const wcs = F.makeWCS(Object.fromEntries(wcsCards));
const skyOf = (x, y) => F.pix2sky(wcs, x + 1, y + 1);

const EP = [60900, 61082], DT = [0, 0.002, 1.0, 2.5, 4.0, 5.5];
const astAt = mjd => { const e = mjd > 61000 ? 1 : 0, t = mjd - EP[e]; return e === 0 ? [40 + 30 * t, 60 + 12 * t] : [60 + 28 * t, 230 - 10 * t]; };
const NEW = [230, 150], HOT = { e: 1, k: 3, x: 180, y: 120 }, GLINT = { e: 1, k: 4, x: 120, y: 250 };
const images = [];
EP.forEach((m, e) => DT.forEach((d, k) => images.push({ url: `https://irsa.ipac.caltech.edu/ibe/data/spherex/v${e}_${k}.fits`, id: `V${e}K${k}`, det: 'D6',
  mjd: m + d, lam0: 4.4, lam1: 5.0, lam: 4.45 + 0.004 * k })));
function makeCutout(e, k) {
  const r = rng(1000 + e * 10 + k), R = rng(99), img = new Float32Array(NX * NX);
  for (let i = 0; i < NX * NX; i++) img[i] = 40 + (r() + r() + r() + r() - 2) * 1.7;
  const src = []; for (let i = 0; i < 70; i++) src.push([20 + R() * 260, 20 + R() * 260, 25 + R() * 250]);
  // keep the test spots clear of stars, so the test is about the method and not about blending
  const clear = [NEW, [HOT.x, HOT.y], [GLINT.x, GLINT.y]];
  for (let i = src.length - 1; i >= 0; i--) if (clear.some(c => Math.hypot(src[i][0] - c[0], src[i][1] - c[1]) < 10)) src.splice(i, 1);
  src.push([...astAt(EP[e] + DT[k]), 120]);
  if (e === 1) src.push([...NEW, 90]);
  if (e === GLINT.e && k === GLINT.k) src.push([GLINT.x, GLINT.y, 80]);
  for (const [sx, sy, a] of src) for (let y = Math.max(0, Math.floor(sy - 8)); y < Math.min(NX, sy + 9); y++) for (let x = Math.max(0, Math.floor(sx - 8)); x < Math.min(NX, sx + 9); x++)
    img[y * NX + x] += a * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.5 ** 2));
  if (e === HOT.e && k === HOT.k) img[HOT.y * NX + HOT.x] += 400;
  return Buffer.concat([Buffer.from(header([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]), 'ascii'), ext('IMAGE', img, wcsCards), ext('ZODI', new Float32Array(NX * NX))]);
}
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=-4,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [], cutouts = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/127\.0\.0\.1:\d+\/api\//, async route => {
    const u = new URL(route.request().url()), q = Object.fromEntries(u.searchParams);
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/spherex/search') return json({ count: images.length, images });
    if (u.pathname === '/api/spherex/cutout') { const m = /v(\d)_(\d)/.exec(q.url); cutouts.push(q.url); return route.fulfill({ status: 200, contentType: 'application/fits', body: makeCutout(+m[1], +m[2]) }); }
    if (u.pathname === '/api/movers') {
      const a = skyOf(...astAt(+q.mjd));
      return json({ mjd: +q.mjd, count: 2, items: [{ num: 7777, name: 'Swiftrock', cls: 'MB>Inner', vmag: 16.5, err: 0.2, dra: 40, ddec: 10, dgeo: 1.1, dsun: 2, ra: a[0], dec: a[1] },
        { num: null, name: '2026 ZZ1', cls: 'MB>Outer', vmag: 23.5, err: 2, dra: 5, ddec: 1, ra: skyOf(150, 40)[0], dec: skyOf(150, 40)[1] }] });
    }
    return json({ error: 'unexpected ' + u.pathname }, 404);
  });

  await page.goto(base + '/#ipe=8');
  await page.waitForSelector('#alist li');
  await page.click('#go');
  await page.fill('#q', '190 -4'); await page.press('#q', 'Enter');
  await page.waitForFunction(() => S.report, null, { timeout: 120000 });
  const states = await page.$$eval('#alist li', els => els.map(e => [e.querySelector('b').firstChild.textContent, e.className.replace('ag ', ''), e.querySelector('small').textContent]));
  console.log(states.map(s => `  ${s[0].padEnd(10)} ${s[1].padEnd(5)} ${s[2]}`).join('\n'));
  assert.deepStrictEqual(states.map(s => s[1]), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(/12 images \(6 per epoch\): 6 colour-matched across epochs/.test(states[1][2]) && /has only 6 images/.test(states[1][2]), states[1][2]);
  assert.ok(/12 of 12 images aligned/.test(states[2][2]), states[2][2]);
  assert.strictEqual(new Set(cutouts).size, 12, 'every image downloaded once');

  const rep = await page.evaluate(() => S.report);
  const ins = rep.insideEpochs;
  console.log('  inside:', JSON.stringify({ sources: ins.sources, unmatched: ins.unmatched, queries: ins.skybotQueries, asteroids: ins.asteroids.map(a => [a.name, a.confirmed, a.sightings.length, a.sightings[0].epoch]) }));
  const sw = ins.asteroids.filter(a => /Swiftrock/.test(a.name));
  assert.ok(sw.length === 2 && sw.every(a => a.confirmed), 'Swiftrock confirmed in both epochs');
  assert.ok(sw.every(a => a.sightings.length >= 5), 'seen in most images: ' + sw.map(a => a.sightings.length));
  assert.ok(sw.every(a => a.sightings.every(g => g.offsetArcsec < 6)), 'positions agree with SkyBoT');
  assert.ok(!ins.asteroids.some(a => /ZZ1/.test(a.name)), 'the V 23.5 object is never "caught"');
  // the hot pixel is never a source; the blurred one-image glint is an unmatched single-visit source
  const all = ins.asteroids.flatMap(a => a.sightings);
  const hotSky = skyOf(HOT.x, HOT.y), glSky = skyOf(GLINT.x, GLINT.y), dist = (p, s) => Math.hypot((p.ra - s[0]) * Math.cos(4 * Math.PI / 180), p.dec - s[1]) * 3600;
  assert.ok(!all.some(g => dist(g, hotSky) < 20) && !rep.candidates.some(c => dist(c.to, hotSky) < 20), 'hot pixel never reported');
  assert.ok(ins.unmatched >= 1, 'glint counted as an unmatched single-visit source');
  // between the epoch stacks: the new source is a change (seen in 6 of 6, absent from 6 of 6); asteroid and glint are not
  const nw = rep.candidates.find(c => dist(c.to, skyOf(...NEW)) < 15);
  console.log('  stack changes:', JSON.stringify(rep.candidates.map(c => [c.kind, +c.snr.toFixed(0), c.status, c.proof.repeat && [c.proof.repeat.seen, c.proof.repeat.of, c.proof.repeat.other && c.proof.repeat.other.seen]])));
  assert.ok(nw && nw.kind === 'new' && nw.proof.repeat.seen === 6 && nw.proof.repeat.of === 6 && nw.proof.repeat.other.seen === 0, 'new source: ' + JSON.stringify(nw && nw.proof.repeat));
  assert.ok(!rep.candidates.some(c => dist(c.to, glSky) < 20), 'one-image glint is gone from the stacks');
  assert.ok(!rep.candidates.some(c => DT.some(d => dist(c.to, skyOf(...astAt(EP[1] + d))) < 15 || dist(c.to, skyOf(...astAt(EP[0] + d))) < 15)), 'moving asteroid is gone from the stacks');
  assert.strictEqual(rep.imagesPerEpoch, 6);

  // Changes view (v0.8): opens after the run; by epoch = new source in epoch-2 colour, by image = asteroid dots labelled known, hot pixel absent
  assert.strictEqual(await page.evaluate(() => S.mode), 'change', 'Changes is the default view after a multi-image run');
  const ch = await page.evaluate(() => { const d = changeData();
    return { items: d.items.length, peaks: d.r.peaks.map(p => ({ k: p.k, kind: p.kind, ra: p.ra, dec: p.dec, snr: p.snr })), bars: document.querySelectorAll('#chgt button').length,
      legend: $('chgl').textContent }; });
  console.log('  changes:', ch.items, 'images,', ch.peaks.length, 'peaks:', JSON.stringify(ch.peaks.slice(0, 8).map(p => [p.k, p.kind, p.snr])));
  assert.strictEqual(ch.items, 12); assert.strictEqual(ch.bars, 12, 'one timeline bar per image');
  assert.ok(/12 SPHEREx images .* 1 known asteroid/.test(ch.legend), 'Explained view (v0.22) is the default: ' + ch.legend);
  await page.click('[data-cv=ep]');
  const epLeg = await page.textContent('#chgl');
  assert.ok(/Epoch 1 .* only/.test(epLeg) && /in every epoch/.test(epLeg), epLeg);
  const newCol = await page.evaluate(([ra, dec]) => { const d = changeData(), n = S.field.n, g = F.skyToGrid(ra, dec, { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n }), o = (Math.round(g[1]) * n + Math.round(g[0])) * 4; return [...d.r.epochRGBA.slice(o, o + 3)]; }, skyOf(...NEW));
  assert.ok(newCol[0] > 100 && newCol[1] < 60 && newCol[2] < 60, 'new source (epoch 2 only) drawn in epoch-2 red: ' + newCol);
  const knownPk = ch.peaks.filter(p => p.kind === 'known');
  assert.ok(knownPk.length >= 6, 'asteroid dots labelled as the known asteroid: ' + knownPk.length);
  // (in this synthetic set the reprojected hot pixel is as blurred as the stars, so it may show as an unconfirmed spot; it must never be called a known asteroid)
  assert.ok(!ch.peaks.some(p => dist(p, hotSky) < 20 && p.kind === 'known'), 'hot pixel never labelled a known asteroid');
  await page.click('[data-cv=im]');
  assert.ok(/colour of time/.test(await page.textContent('#help')) && /grey/.test(await page.textContent('#chgl')));
  await page.evaluate(() => showChange(changeData().r.peaks.find(p => p.kind === 'known')));
  assert.ok(/Known asteroid .*Swiftrock/.test(await page.textContent('#card')), await page.textContent('#card'));
  await page.click('#chgt button:nth-of-type(3)');
  assert.strictEqual(await page.evaluate(() => [S.mode, S.ti].join()), 'time,2', 'a timeline bar opens its image');

  // UI: film strip, Time machine through 12 images, Blink flip-book, stack views, asteroid proof card
  assert.strictEqual(await page.$$eval('#strip .th', b => b.length), 12);
  assert.ok(await page.$$eval('#strip .th.ast', b => b.length) >= 10, 'images with a caught asteroid are marked');
  await page.click('#strip .sg:nth-child(2) .th:nth-child(3)');
  assert.strictEqual(await page.evaluate(() => [S.mode, S.ti, $('tml').textContent, $('tm').max].join()), 'time,7,Image,11');
  assert.ok(/8 of 12 · E2 #2/.test(await page.textContent('#tmo')), await page.textContent('#tmo'));
  await page.click('[data-m=blink]');
  assert.strictEqual(await page.evaluate(() => [$('tml').textContent, $('tm').max].join()), 'Blink,2');
  await page.waitForTimeout(1500);
  const blinkSeen = await page.evaluate(() => S.blinkAt);
  assert.ok(blinkSeen >= 0, 'flip-book runs');
  await page.click('[data-m=diff]');
  assert.ok(/stacks of 6/.test(await page.textContent('#tmo')), await page.textContent('#tmo'));
  await page.evaluate(() => showAsteroid(S.inside.asteroids.find(a => /Swiftrock/.test(a.name) && a.e === 0)));
  const cardTxt = await page.textContent('#card');
  assert.ok(/Confirmed known asteroid/.test(cardTxt) && /✓ Position/.test(cardTxt) && /✓ Motion/.test(cardTxt), cardTxt);
  assert.strictEqual(await page.$$eval('#card .proof canvas', c => c.length), 4, 'three sightings + one "gone" crop');
  await page.evaluate(() => showCand(S.report.candidates.find(c => c.kind === 'new')));
  assert.ok(/Repeat: Seen in 6 of 6 images of epoch 2, in 0 of 6 images of epoch 1/.test(await page.textContent('#card')), await page.textContent('#card'));
  if (process.env.SHOT) {
    await page.evaluate(() => showAsteroid(S.inside.asteroids.find(a => /Swiftrock/.test(a.name) && a.e === 0)));
    await page.click('[data-m=time]'); await page.waitForTimeout(300); await page.screenshot({ path: process.env.SHOT });
  }
  assert.deepStrictEqual(errors, [], 'browser errors:\n' + errors.join('\n'));
  await browser.close(); server.close();
  console.log('\nMULTI-IMAGE E2E passed');
})().catch(e => { console.error(e); process.exit(1); });
