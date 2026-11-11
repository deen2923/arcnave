// prune must keep the seeded example files even when the cache is over its limit
// v0.56: and the files tools/pin-cache.js pinned (the start screen's prewarmed fields)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-')); process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_CACHE_MB = '0.001';
const assert = require('assert'); const server = require('../server'); const n = server.seedCache();
fs.writeFileSync(path.join(TMP, 'cutouts', 'other.bin'), Buffer.alloc(5000));
// a prewarmed field: pinned by the tool (its files were used in the last minutes), then made "old" like everything else
fs.writeFileSync(path.join(TMP, 'cutouts', 'pinned-field.fits.gz'), Buffer.alloc(5000));
fs.writeFileSync(path.join(TMP, 'api', 'search-pinned.json'), '{}');
for (const sub of ['cutouts', 'api']) for (const f of fs.readdirSync(path.join(TMP, sub))) if (!/pinned/.test(f)) fs.utimesSync(path.join(TMP, sub, f), 1, 1);
const out = cp.execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'pin-cache.js'), TMP, '--newer-than', '5'], { encoding: 'utf8' });
assert.ok(/2 files/.test(out), out);
for (const sub of ['cutouts', 'api']) for (const f of fs.readdirSync(path.join(TMP, sub))) fs.utimesSync(path.join(TMP, sub, f), 1, 1);   // all "old"
server._test.prune().then(() => { const left = fs.readdirSync(path.join(TMP, 'cutouts')); const seeded = fs.readdirSync(path.join(__dirname, '../demo-cache/cutouts'));
  assert.ok(seeded.length > 0 && seeded.every(f => left.includes(f)), 'every shipped example cutout survives');
  assert.ok(left.includes('pinned-field.fits.gz') && fs.readdirSync(path.join(TMP, 'api')).includes('search-pinned.json'), 'pinned files survive');
  assert.ok(!left.includes('other.bin'), 'other old files are still pruned');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  cache over its limit: ${seeded.length} example cutouts and the pinned files kept, other old files removed`); });
