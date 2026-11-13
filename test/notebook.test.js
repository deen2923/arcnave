'use strict';
// v0.57.5: the Jupyter notebook export (public/notebook.js). Offline: the notebook is valid nbformat 4, carries the spot,
// and the .py made from the same cells has the same code. (Running it needs Python + IRSA: done by hand, see README.)
const assert = require('assert');
const NB = require('../public/notebook.js');

const r = NB.build({ ra: 269.44627, dec: 4.7682, size: 0.5, band: 3.45, name: "Barnard's Star", url: 'http://localhost:8083/#ct=barnard', version: '0.57.5' });
const nb = JSON.parse(r.json);
assert.strictEqual(nb.nbformat, 4);
assert.ok(nb.cells.length >= 10 && nb.cells.every(c => Array.isArray(c.source) && ['markdown', 'code'].includes(c.cell_type)), 'cells');
assert.ok(nb.cells.filter(c => c.cell_type === 'code').every(c => Array.isArray(c.outputs) && c.execution_count === null), 'code cells are empty, ready to run');
assert.ok(nb.cells.every(c => c.source.slice(0, -1).every(l => l.endsWith('\n'))), 'every source line but the last ends with a newline');
const code = nb.cells.filter(c => c.cell_type === 'code').map(c => c.source.join('')).join('\n');
assert.ok(code.includes('ra, dec = 269.44627, 4.76820') && code.includes('size = 0.500') && code.includes('band = 3.45'), 'the spot is in the setup cell');
assert.ok(code.includes("FROM spherex.artifact a JOIN spherex.plane p") && !/release|qr\d|dr\d/i.test(code.split('ORDER BY p.time_bounds_lower')[0].split('WHERE')[1]), "ARCNAVE's query, no release filter");
assert.ok(code.includes("key='W'") && code.includes('gaia_dr3_source') && code.includes('ORDER BY phot_g_mean_mag') && code.includes('PillowWriter'), 'spectral WCS, Gaia (brightest first), film');
assert.ok(!code.includes('${'), 'no unfilled JS template');
assert.strictEqual(r.file, 'arcnave_Barnard_s_Star');
assert.ok(r.py.includes(code.split('\n')[0]) && r.py.split('\n').filter(l => l.startsWith('# ')).length > 10, '.py: the same code, the text as comments');
assert.deepStrictEqual(nb.metadata.arcnave, { ra: 269.44627, dec: 4.7682, size: 0.5, band: 3.45, url: 'http://localhost:8083/#ct=barnard', version: '0.57.5' });

// a name with quotes and a line break stays one valid Python string; the cutout size is kept to 0.02-0.5 degrees
const odd = NB.build({ ra: 10, dec: -20, size: 3, band: 1.2, name: 'a "b"\nc\\d' });
assert.ok(odd.py.includes('name = "a \\"b\\" c\\\\d"') && odd.py.includes('size = 0.500'), 'quotes escaped, line break dropped, size capped: ' + odd.py.match(/name = .*/)[0]);
assert.ok(NB.build({ ra: 10, dec: 0, size: 0.001, band: 2 }).py.includes('size = 0.020') && NB.build({ ra: 10, dec: 0, band: 2 }).file === 'arcnave_field', 'small size raised, no name');
assert.throws(() => NB.build({ ra: 'x', dec: 0, band: 2 }), /not a number/);
console.log('notebook.test: ok (' + nb.cells.length + ' cells, ' + r.json.length + ' bytes)');
