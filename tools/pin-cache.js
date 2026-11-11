'use strict';
// v0.56: keep the start screen's fields in the cache for good. After a prewarm run (http://localhost:8083/#prewarm=start),
//   node tools/pin-cache.js [cache folder] --newer-than <minutes>
// adds every cutout and archive answer the run read or wrote (the server refreshes a file's time on every hit) to
// <cache>/pinned.json. The server's prune never removes a pinned file, as with the shipped demo-cache. Running it again
// adds to the list; --clear empties it first.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), i = args.indexOf('--newer-than');
const minutes = i >= 0 ? +args[i + 1] : NaN, clear = args.includes('--clear');
const dir = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--newer-than') || process.env.SKYSHIFT_CACHE_DIR || path.join(__dirname, '..', 'cache');
if (!(minutes > 0)) { console.error('usage: node tools/pin-cache.js [cache folder] --newer-than <minutes> [--clear]'); process.exit(1); }
const since = Date.now() - minutes * 60e3, file = path.join(dir, 'pinned.json');
let pin = { cutouts: [], api: [] };
if (!clear) { try { pin = Object.assign(pin, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* new list */ } }
let added = 0, bytes = 0;
for (const sub of ['cutouts', 'api']) {
  const have = new Set(pin[sub]); let names = [];
  try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
  for (const nm of names) {
    if (nm.endsWith('.tmp')) continue;
    let st; try { st = fs.statSync(path.join(dir, sub, nm)); } catch { continue; }
    if (st.mtimeMs < since || have.has(nm)) continue;
    have.add(nm); added++; bytes += st.size;
  }
  pin[sub] = [...have];
}
pin.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(pin));
console.log(`${added} files (${(bytes / 1e6).toFixed(1)} MB) pinned; ${pin.cutouts.length} cutouts and ${pin.api.length} answers in ${file}`);
