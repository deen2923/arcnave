// prune must keep the seeded example files even when the cache is over its limit
const fs = require('fs'), path = require('path'), os = require('os');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-')); process.env.SKYSHIFT_CACHE_DIR = TMP; process.env.SKYSHIFT_CACHE_MB = '0.001';
const assert = require('assert'); const server = require('../server'); const n = server.seedCache();
fs.writeFileSync(path.join(TMP, 'cutouts', 'other.bin'), Buffer.alloc(5000));
for (const f of fs.readdirSync(path.join(TMP, 'cutouts'))) fs.utimesSync(path.join(TMP, 'cutouts', f), 1, 1);   // all "old"
server._test.prune().then(() => { const left = fs.readdirSync(path.join(TMP, 'cutouts')); const seeded = fs.readdirSync(path.join(__dirname, '../demo-cache/cutouts'));
  assert.ok(seeded.length > 0 && seeded.every(f => left.includes(f)), 'every shipped example cutout survives');
  assert.ok(!left.includes('other.bin'), 'other old files are still pruned');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ok  cache over its limit: ${seeded.length} example cutouts kept, other old files removed`); });
