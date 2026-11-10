'use strict';
// "Find the asteroid" (v0.18): from the intro button, the game opens on the shipped asteroid example (no network), shows
// the same patch in several real images, a wrong tap gives a hint, a tap on the asteroid wins and names it, the reveal
// says it is known (no discovery claim), and the discovery card's post text is the game one. Desktop and phone.
// Run: node test/game.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arcnave-game-'));
process.env.SKYSHIFT_CACHE_DIR = TMP;
const server = require('../server');
server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
const SHOT = process.env.SHOT;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), errors = [];
  try {
    for (const vp of [{ width: 1400, height: 880, name: 'desktop' }, { width: 390, height: 844, name: 'phone', isMobile: true, hasTouch: true }]) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
      page.setDefaultTimeout(180000);
      page.on('pageerror', e => errors.push(vp.name + ': ' + e.message));
      await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.route(/amazonaws\.com/, r => r.abort());   // no S3 in the test: the shipped cache answers
      await page.goto(base + '/'); await page.waitForSelector('#intro .ex.play');
      const t = Date.now();
      await page.click('#intro .ex.play');
      await page.waitForFunction(() => document.getElementById('game').open && GAME.plan);
      const info = await page.evaluate(() => ({ n: GAME.plan.ims.length, inF: GAME.plan.inFrames, name: GAME.plan.a.name, msg: document.getElementById('gmsg').textContent, hash: location.hash,
        off: Math.hypot(GAME.plan.sg[0].x - GAME.plan.cx, GAME.plan.sg[0].y - GAME.plan.cy) / GAME.plan.half }));
      console.log(`  ${vp.name}: game open in ${((Date.now() - t) / 1000).toFixed(1)} s, ${info.n} images, asteroid in ${info.inF}, ${info.name}`);
      assert.ok(info.n >= 4 && info.inF >= 1 && info.inF < info.n, 'some images with it, some without');
      assert.ok(/3865 Lindbloom/.test(info.name)); assert.strictEqual(info.hash, '#play');
      assert.ok(info.off < 0.8, 'asteroid inside the crop');
      await page.waitForTimeout(1500);
      const fr = await page.evaluate(() => GAME.i); assert.ok(fr >= 1, 'flipping by itself');
      // the canvas really shows image pixels (not blank)
      const lit = await page.evaluate(() => { gamePlay(false); const c = document.getElementById('gcv'); let n = 0, all = 0; for (let f = 0; f < GAME.plan.ims.length; f++) { GAME.i = f; gameDraw(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { all++; if (d[i] + d[i + 1] + d[i + 2] > 60) n++; } } gamePlay(true); return n / all; });   // over all frames: one easy-level frame can be all black
      assert.ok(lit > 0.0005, 'something drawn: ' + lit.toFixed(4));
      const at = (dx, dy) => page.evaluate(([dx, dy]) => { const P = GAME.plan, c = document.getElementById('gcv'), r = c.getBoundingClientRect(), k = r.width / (2 * P.half), s = P.sg[0];
        return [r.left + (s.x + dx - (P.cx - P.half) + 0.5) * k, r.top + (s.y + dy - (P.cy - P.half) + 0.5) * k]; }, [dx, dy]);
      // a wrong tap far from it
      const P0 = await page.evaluate(() => { const P = GAME.plan; return { dx: P.sg[0].x < P.cx ? 20 : -20, dy: P.sg[0].y < P.cy ? 20 : -20 }; });
      let [x, y] = await at(P0.dx, P0.dy); await page.mouse.click(x, y);
      const miss = await page.evaluate(() => ({ tries: GAME.tries, done: GAME.done, msg: document.getElementById('gmsg').textContent }));
      assert.ok(miss.tries === 1 && !miss.done && /Not that one/.test(miss.msg), 'wrong tap explained');
      assert.ok(await page.evaluate(() => GAME.level === 'easy' && document.querySelector('#glev [data-lev=easy]').getAttribute('aria-pressed') === 'true'), 'easy level by default');
      await page.click('#ghint'); assert.ok(await page.evaluate(() => !!GAME.hint), 'hint');
      [x, y] = await at(0.5, -0.5); await page.mouse.click(x, y);
      const win = await page.evaluate(() => ({ done: GAME.done, won: GAME.won, h: document.getElementById('gresh').textContent, t: document.getElementById('grest').textContent, s: document.getElementById('grests').textContent, card: !document.getElementById('gcard').hidden }));
      console.log(`  ${vp.name}: ${win.h} ${win.s}`);
      assert.ok(win.done && win.won && /Yes! That's 3865 Lindbloom/.test(win.h) && win.card);
      assert.ok(/not a new discovery/.test(win.t) && /moved \d+″/.test(win.t), 'honest reveal with the motion');
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `game-${vp.name}.png`) });
      await page.click('#gcard');
      await page.waitForFunction(() => document.getElementById('dcd').open && CARD.last, null, { timeout: 60000 });
      const post = await page.evaluate(() => document.getElementById('dcdtxt').value);
      assert.ok(/I spotted asteroid 3865 Lindbloom/.test(post) && /#play/.test(post) && /no new discovery/.test(post), 'game post text: ' + post);
      // the real level: stars back (much more lit)
      await page.evaluate(() => { document.getElementById('dcd').close(); });
      await page.evaluate(() => startGame()); await page.waitForFunction(() => document.getElementById('game').open);
      await page.click('#glev [data-lev=real]'); await page.waitForTimeout(400);
      const lit2 = await page.evaluate(() => { const c = document.getElementById('gcv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return [GAME.level, n / (d.length / 4)]; });
      assert.ok(lit2[0] === 'real' && lit2[1] > lit * 2, 'real level shows the stars: ' + lit2[1].toFixed(4));
      await page.click('#glev [data-lev=easy]');
      // play again resets
      await page.evaluate(() => { document.getElementById('dcd').close(); });
      await page.evaluate(() => startGame());
      await page.waitForFunction(() => document.getElementById('game').open && !GAME.done && GAME.tries === 0);
      // 4 wrong taps: reveal without winning
      const P1 = await page.evaluate(() => { const P = GAME.plan; return { dx: P.sg[0].x < P.cx ? 20 : -20, dy: P.sg[0].y < P.cy ? 16 : -16 }; });
      for (let k = 0; k < 4; k++) { [x, y] = await at(P1.dx, P1.dy + k * 2 * Math.sign(P1.dy)); await page.mouse.click(x, y); }
      const lose = await page.evaluate(() => ({ done: GAME.done, won: GAME.won, card: !document.getElementById('gcard').hidden, h: document.getElementById('gresh').textContent }));
      assert.ok(lose.done && !lose.won && !lose.card && /Here it is/.test(lose.h), 'reveal after 4 misses');
      await page.close();
    }
    // a shared #play link opens the game directly
    const page = await browser.newPage();
    await page.route(/aladin\.cds\.unistra\.fr|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
    await page.route(/fonts\.(googleapis|gstatic)\.com|amazonaws/, r => r.abort());
    await page.goto(base + '/#play'); await page.waitForFunction(() => document.getElementById('game').open && GAME.plan, null, { timeout: 120000 });
    await page.close();
    assert.deepStrictEqual(errors, []);
    console.log('\nGAME E2E passed (intro button, #play link, wrong tap + hint + win, reveal, game card text, lose path; desktop and phone)');
  } finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
