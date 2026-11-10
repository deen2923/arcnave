'use strict';
// Hide Planet X on REAL data, offline: the "Catch a real asteroid" example (24 SPHEREx images, demo-cache), then the
// Hide Planet X tab. Checks the epoch pair (largest Earth baseline, not the passes a year apart), a bright fake at 500 AU
// is found, a faint one is missed as "too faint", a 50 AU one is missed because it moves during a pass, and a small map runs.
// Run: node test/px.e2e.js   (needs Playwright + Chromium)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.SKYSHIFT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'skyshift-px-'));
const server = require('../server'); server.seedCache();
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=5,fov=1.5;return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 880 } }), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/aladin\.cds|\/vendor\/aladin-lite/, r => r.fulfill({ contentType: 'text/javascript', body: STUB })); await p.route(/fonts\./, r => r.abort());
  try {
    await p.goto('http://127.0.0.1:' + server.address().port + '/#ex=proof'); await p.waitForFunction(() => S.report, null, { timeout: 180000 });
    await p.click('[data-m="px"]');
    const hide = async (d, m) => { await p.evaluate(([d, m]) => { $('pxd').value = d; $('pxm').value = m; $('pxd').oninput(); S.px.spot = { x: 150.3, y: 120.6 }; }, [d, m]); await p.click('#pxgo'); return (await p.textContent('#card')).replace(/\s+/g, ' '); };
    const c1 = await hide(6, 15), pair = await p.evaluate(() => [S.px.ctx.a, S.px.ctx.b, S.px.ctx.earthAU]);
    console.log('  pair', pair, '\n  500 AU AB 15:', c1.slice(0, 160));
    assert.deepStrictEqual(pair.slice(0, 2), [0, 1], 'epochs 1 and 2 (Earth ~1.9 AU apart), not 1 and 3 (a year apart)'); assert.ok(pair[2] > 1.5);
    assert.ok(/Found by the agents/.test(c1), c1);
    const c2 = await hide(6, 19); console.log('  500 AU AB 19:', c2.slice(0, 160)); assert.ok(/Missed/.test(c2) && /Too faint/.test(c2), c2);
    const c3 = await hide(0, 15); console.log('  50 AU AB 15:', c3.slice(0, 160)); assert.ok(/Missed/.test(c3) && /during one pass/.test(c3), c3);
    const st = await p.textContent('#stat'); console.log('  status:', st); assert.ok(/Hide Planet X: Epoch 1.* vs Epoch 2/.test(st), 'status names the compared passes: ' + st);
    assert.ok(/fake planet/i.test(c1) && /nothing here is a real detection/.test(c1), 'honesty line');
    await p.evaluate(() => { PXM.dists = [300, 1000]; PXM.positions = 4; }); await p.click('#pxmap');
    await p.waitForFunction(() => S.px.map, null, { timeout: 300000 });
    const lim = await p.evaluate(() => S.px.map.limits); console.log('  map limits', JSON.stringify(lim), '|', await p.textContent('#pxs'));
    assert.ok(lim.every(l => l.ab50 != null && l.ab50 >= 15 && l.ab50 <= 18), 'a limit for 300 and 1000 AU');
    assert.deepStrictEqual(errs, [], errs.join('\n'));
    console.log('\nHIDE PLANET X E2E (real field 189.957 -4.182, 24 images) passed');
  } finally { await b.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
