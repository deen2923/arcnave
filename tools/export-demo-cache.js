'use strict';
// Add more example fields to the site. 1) run the server locally, open the field in the app until the Report appears
// (in 8-per-epoch mode and/or 1-per-epoch mode, whichever the example uses). 2) node tools/export-demo-cache.js <cache folder>
// copies the downloaded cutouts and the answers into demo-cache/ (what the public site ships). 3) add the field to EXAMPLES in
// public/app.js and test/examples.e2e.js. Only the files in `--newer-than <minutes>` are copied, so old browsing is left out.
const fs = require('fs'), path = require('path');
const src = process.argv[2] || process.env.SKYSHIFT_CACHE_DIR, i = process.argv.indexOf('--newer-than');
const since = i > 0 ? Date.now() - 60000 * +process.argv[i + 1] : 0;
if (!src) { console.error('usage: node tools/export-demo-cache.js <cache folder> [--newer-than <minutes>]'); process.exit(1); }
let n = 0, bytes = 0;
for (const sub of ['cutouts', 'api']) {
  let names = []; try { names = fs.readdirSync(path.join(src, sub)); } catch { continue; }
  const out = path.join(__dirname, '..', 'demo-cache', sub); fs.mkdirSync(out, { recursive: true });
  for (const nm of names) {
    const from = path.join(src, sub, nm); if (fs.statSync(from).mtimeMs < since) continue;
    fs.copyFileSync(from, path.join(out, nm)); n++; bytes += fs.statSync(from).size;
  }
}
console.log(`${n} files (${(bytes / 1e6).toFixed(1)} MB) copied into demo-cache/`);
