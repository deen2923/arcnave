/* ARCNAVE v0.57.5: "this spot in Python", as a Jupyter notebook (and the same code as one .py file).
   The challenge's resources include IRSA's SPHEREx tutorial notebooks (Astropy + astroquery). This writes one for the spot on
   screen that redoes, step by step and in the open, what ARCNAVE shows: the archive search (ARCNAVE's own query, no release
   filter), one image per pass lined up on the sky (blink film as a GIF, difference image), Gaia DR3 stars moved to each
   date by their proper motions, and a spectrum on the fly from the images' own wavelength tables (WCS-WAVE).
   Needs: pip install astroquery matplotlib reproject. Works in Node (tests) and the browser (window.ArcNotebook). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArcNotebook = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const num = (x, d) => { const v = +x; if (!Number.isFinite(v)) throw new Error('not a number: ' + x); return v.toFixed(d); };
  const pyStr = s => JSON.stringify(String(s == null ? '' : s));   // a JSON string is a valid Python string literal

  // Each cell: ['md' | 'code', text]. Python is kept free of "${" so the cells can live in plain JS strings.
  function cells(p) {
    const ra = num(p.ra, 5), dec = num(p.dec, 5), size = num(Math.min(0.5, Math.max(0.02, +p.size || 0.1)), 3), band = num(p.band || 3, 2);
    const name = String(p.name || '').replace(/[\r\n]/g, ' ').slice(0, 80), file = (name || 'field').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';
    return [
      ['md', `# ARCNAVE → Python: ${name ? name + ', ' : ''}RA ${ra}°, Dec ${dec}°

This notebook redoes, in plain Python, what [ARCNAVE](${p.url || 'https://github.com/'}) shows for this patch of sky, using real **NASA SPHEREx** images from **NASA/IPAC IRSA**:

1. **Search** the archive (ARCNAVE's own query: every data release, QR and DR1, with no release filter)
2. **One image per pass**, lined up on the sky: a **blink film** (GIF) and a **difference image**, so anything that moved stands out
3. **Gaia DR3** stars moved to each image's date by their proper motions
4. A **spectrum on the fly** at the centre, from each image's own wavelength table (WCS-WAVE)

Made by ARCNAVE ${p.version ? 'v' + p.version + ' ' : ''}for the NASA Space Apps 2026 *Planet X and SPHEREx* challenge, in the style of [IRSA's SPHEREx tutorial notebooks](https://caltech-ipac.github.io/irsa-tutorials/spherex/).
Install once: \`pip install astroquery matplotlib reproject\`. Downloads are small cutouts, not whole 70 MB images.`],
      ['code', `import warnings
warnings.simplefilter('ignore')          # astropy notes about SPHEREx's SIP keywords; harmless here
import re
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import matplotlib.pyplot as plt
from matplotlib import animation
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area
from astropy.time import Time
from astropy.utils.data import conf
from astropy import log
from astroquery.ipac.irsa import Irsa
conf.remote_timeout = 120
log.setLevel('WARNING')                  # astropy's notes about SPHEREx's SIP keywords; harmless here
def show(obj):                           # pictures inline in Jupyter; nothing in a plain script
    try:
        get_ipython; from IPython.display import display; display(obj)
    except NameError:
        pass

# The spot, as it was on screen in ARCNAVE
ra, dec = ${ra}, ${dec}   # degrees (ICRS)
size = ${size}                # cutout side, degrees (ARCNAVE's field of view)
band = ${band}                # colour picked in ARCNAVE, micrometres
name = ${pyStr(name)}
out = ${pyStr('arcnave_' + file)}   # file names for the film and the spectrum
N_SPEC = 60                  # images used for the spectrum (more = slower, finer)`],
      ['md', `## 1. Which SPHEREx images cover this spot?
The same ADQL query ARCNAVE sends to IRSA. SPHEREx maps the whole sky every six months, so the images come in **passes**; a gap of more than 60 days starts a new one. The data release is part of every file path (\`.../spherex/dr1/...\`), so new releases show up here without changing anything.`],
      ['code', `query = f"""
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS url, p.time_bounds_lower AS mjd,
       p.energy_bandpassname AS det, p.energy_bounds_lower AS lam0, p.energy_bounds_upper AS lam1
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower"""
t = Irsa.query_tap(query).to_table()
if len(t) == 0:
    raise SystemExit('No SPHEREx images cover this spot yet. Try another position.')
t['release'] = [((re.search(r'/spherex/([a-z]+\\d*)/', u) or [None, '?'])[1]).upper() for u in t['url']]
t['pass'] = np.cumsum(np.r_[0, np.diff(np.asarray(t['mjd'], float)) > 60])
cut = lambda url, s: f"{url}?center={ra},{dec}d&size={s}"     # IRSA's cutout service: just this patch
iso = lambda m: Time(m, format='mjd').iso[:10]
rels = {str(r): int(n) for r, n in zip(*np.unique(t['release'], return_counts=True))}
print(len(t), 'SPHEREx images cover this spot; releases:', rels)
for k in np.unique(t['pass']):
    m = t['pass'] == k
    print(f"  pass {k + 1}: {iso(t['mjd'][m].min())} to {iso(t['mjd'][m].max())}, {m.sum()} images")`],
      ['md', `## 2. One image per pass, lined up: the blink film and the difference
For each pass, an image whose detector covers your colour (SPHEREx's filter changes across each detector, so the exact colour differs a little). Each is put on the first image's sky grid with \`reproject\`, so stars sit on the same pixels and only movers jump.`],
      ['code', `from reproject import reproject_interp

def first_cover(rows):
    ok = [r for r in rows if r['lam0'] * 1e6 <= band <= r['lam1'] * 1e6]
    return ok[len(ok) // 2] if ok else rows[len(rows) // 2]

picks = [first_cover([r for r in t if r['pass'] == k]) for k in np.unique(t['pass'])]
def load(row):
    with fits.open(cut(row['url'], size)) as h:
        return h['IMAGE'].data.astype(float), WCS(h['IMAGE'].header).celestial
with ThreadPoolExecutor(4) as ex:
    imgs = list(ex.map(load, picks))
ref_img, ref_w = imgs[0]
frames = []
for (img, w) in imgs:
    a, _ = reproject_interp((img, w), ref_w, shape_out=ref_img.shape)
    frames.append(a - np.nanmedian(a))          # flatten the sky glow (zodiacal light) between passes
dates = [iso(r['mjd']) for r in picks]
x0, y0 = ref_w.world_to_pixel_values(ra, dec)
lo, hi = np.nanpercentile(np.concatenate([f.ravel() for f in frames]), [5, 99.7])

fig, axes = plt.subplots(1, len(frames) + 1, figsize=(3.4 * (len(frames) + 1), 3.6), subplot_kw={'projection': ref_w})
for ax, f, d, r in zip(axes, frames, dates, picks):
    ax.imshow(f, origin='lower', cmap='gray', vmin=lo, vmax=hi)
    ax.plot(x0, y0, 'o', mfc='none', mec='cyan', ms=18)
    ax.set_title(f"{d}  {r['det'].replace('SPHEREx-', '')}  {r['release']}", fontsize=9)
diff = frames[-1] - frames[0]
s = np.nanstd(diff[np.isfinite(diff)]) or 1
axes[-1].imshow(diff, origin='lower', cmap='RdBu_r', vmin=-5 * s, vmax=5 * s)
axes[-1].set_title('last minus first\\n(red = new, blue = gone)', fontsize=9)
for ax in axes:
    ax.coords[0].set_ticklabel_visible(False); ax.coords[1].set_ticklabel_visible(False)
plt.tight_layout(); plt.show()

# The "little video" the challenge asks for: the passes one after the other
fig2, ax2 = plt.subplots(figsize=(5, 5)); ax2.axis('off')
im = ax2.imshow(frames[0], origin='lower', cmap='gray', vmin=lo, vmax=hi)
ax2.plot(x0, y0, 'o', mfc='none', mec='cyan', ms=22)
title = ax2.set_title(dates[0])
def step(i):
    im.set_data(frames[i]); title.set_text(f"SPHEREx {dates[i]}  (pass {i + 1} of {len(frames)})"); return im, title
anim = animation.FuncAnimation(fig2, step, frames=len(frames), interval=700)
anim.save(out + '.gif', writer=animation.PillowWriter(fps=1.4)); plt.close(fig2)
print('Blink film saved:', out + '.gif')
try:
    from IPython.display import Image
    show(Image(filename=out + '.gif'))
except ImportError:
    pass`],
      ['md', `## 3. Gaia DR3 stars, moved to each date
Gaia measured positions at epoch J2016.0 and how fast each star moves (proper motion). Moving them to each image's date shows which stars **should** have shifted between passes. A star that moves fast enough jumps visibly in the blink.`],
      ['code', `r = size / 2 ** 0.5                     # the cutout's corners
g = Irsa.query_tap(f"""SELECT TOP 2000 source_id, ra, dec, pmra, pmdec, phot_g_mean_mag AS g FROM gaia_dr3_source
WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {r})) AND phot_g_mean_mag < 18
ORDER BY phot_g_mean_mag""").to_table()                  # brightest first, so a bright fast star is never cut off
g = g[np.isfinite(np.asarray(g['pmra'], float)) & np.isfinite(np.asarray(g['pmdec'], float))]
def gaia_at(mjd):
    yr = (mjd - 57388.5) / 365.25                     # years since J2016.0
    cd = np.cos(np.radians(np.asarray(g['dec'], float)))
    return (np.asarray(g['ra'], float) + np.asarray(g['pmra'], float) / 3.6e6 * yr / cd,
            np.asarray(g['dec'], float) + np.asarray(g['pmdec'], float) / 3.6e6 * yr)
gx0, gy0 = ref_w.world_to_pixel_values(*gaia_at(picks[0]['mjd']))
ny, nx = ref_img.shape
inside = (gx0 > 0) & (gy0 > 0) & (gx0 < nx - 1) & (gy0 < ny - 1)   # on the cutout, not just in the circle
pm = np.hypot(np.asarray(g['pmra'], float), np.asarray(g['pmdec'], float)) / 1000   # arcsec per year
fast = [i for i in np.argsort(-pm) if inside[i]][:5]
print(int(inside.sum()), 'Gaia DR3 stars (G < 18) on these images; the fastest:')
for i in fast:
    print(f"  Gaia DR3 {g['source_id'][i]}: G {g['g'][i]:.1f}, {pm[i]:.2f} arcsec/yr")
draw = [i for i in range(len(g)) if inside[i]][:300]          # the 300 brightest, so the picture stays readable

fig, axes = plt.subplots(1, len(frames), figsize=(3.6 * len(frames), 3.8), subplot_kw={'projection': ref_w})
axes = np.atleast_1d(axes)
for ax, f, row in zip(axes, frames, picks):
    ax.imshow(f, origin='lower', cmap='gray', vmin=lo, vmax=hi)
    gx, gy = ref_w.world_to_pixel_values(*gaia_at(row['mjd']))
    ax.scatter(gx[draw], gy[draw], s=40, facecolors='none', edgecolors='orange', lw=0.6)
    if fast:
        ax.scatter(gx[fast[:1]], gy[fast[:1]], s=220, facecolors='none', edgecolors='magenta', lw=1.6)
    ax.set_xlim(-0.5, nx - 0.5); ax.set_ylim(-0.5, ny - 0.5)
    ax.set_title(iso(row['mjd']), fontsize=9)
    ax.coords[0].set_ticklabel_visible(False); ax.coords[1].set_ticklabel_visible(False)
plt.suptitle('Gaia DR3 moved to each date (orange); the fastest star here (magenta)', fontsize=10)
plt.tight_layout(); plt.show()`],
      ['md', `## 4. A spectrum on the fly
SPHEREx sees each spot in 102 colours, one colour per position on its detectors. Each image carries a wavelength table (**WCS-WAVE**); \`WCS(..., key='W')\` turns the star's pixel into its exact wavelength. Brightness: sum over a small circle minus the median of a ring around it (the sky), from MJy/sr to mJy with the pixel's solid angle. Uses the pass with the most images.`],
      ['code', `k = np.bincount(np.asarray(t['pass'])).argmax()
rows = [r for r in t if r['pass'] == k]
rows = [rows[i] for i in np.unique(np.linspace(0, len(rows) - 1, min(N_SPEC, len(rows))).astype(int))]
BAD = {'OVERFLOW', 'NONLINEAR', 'BLOOM', 'SUR_ERROR', 'MISSING_DATA', 'NONFUNC'}   # saturated or unusable pixels
def bad_bits(fh):     # the FLAGS header names its bits: MSKN0001 = 'OVERFLOW' (DR1, QR3) or MP_OVERFLOW = 1 (QR2)
    b = 0
    for k in fh:
        if k.startswith('MSKN') and str(fh[k]).strip() in BAD: b |= 1 << int(k[4:])
        elif k.startswith('MP_') and k[3:] in BAD: b |= 1 << int(fh[k])
    return b
def phot(row):
    try:
        with fits.open(cut(row['url'], 0.03)) as h:
            img = h['IMAGE'].data.astype(float); w = WCS(h['IMAGE'].header).celestial
            x, y = w.world_to_pixel_values(ra, dec)
            lam, bw = WCS(h['IMAGE'].header, fobj=h, key='W').pixel_to_world(x, y)
            yy, xx = np.indices(img.shape); d = np.hypot(xx - x, yy - y)
            sky = np.nanmedian(img[(d > 4) & (d < 7)])
            ap = d <= 2.0
            flagged = bool(np.bitwise_or.reduce(h['FLAGS'].data[ap].astype(np.int64)) & bad_bits(h['FLAGS'].header))
            sr = proj_plane_pixel_area(w) * np.radians(1) ** 2               # solid angle of one pixel (deg² -> sr)
            return float(lam.to_value('um')), float(bw.to_value('um')), float(np.nansum(img[ap] - sky) * sr * 1e9), str(row['det']), flagged
    except Exception:
        return None                       # an image that does not answer is left out
with ThreadPoolExecutor(8) as ex:
    sp = [s for s in ex.map(phot, rows) if s]
sp.sort()
lam, bw, mjy, det, flg = map(np.array, zip(*sp))
plt.figure(figsize=(8, 4))
for dname in np.unique(det):
    m = (det == dname) & ~flg
    if m.any():
        plt.errorbar(lam[m], mjy[m], xerr=bw[m] / 2, fmt='o', ms=4, label=dname.replace('SPHEREx-', ''))
if flg.any():
    plt.plot(lam[flg], mjy[flg], 'o', mfc='none', mec='grey', ms=6, label='saturated / flagged')
if (~flg).sum() >= 3:                     # scale to the trusted points; a flagged one far off stays at the edge
    a, b = np.percentile(mjy[~flg], [0, 100]); pad = 0.15 * (b - a) + 1e-3
    plt.ylim(a - pad, b + pad)
plt.xlabel('wavelength (micrometres)'); plt.ylabel('brightness (mJy)')
plt.title(f"SPHEREx spectrum at RA {ra}, Dec {dec} ({len(sp)} images, pass {k + 1})")
plt.legend(fontsize=8, ncol=4); plt.grid(alpha=.3); plt.tight_layout(); plt.show()
print(f"{len(sp)} images measured; {int(flg.sum())} with saturated or unusable pixels on the star (grey: do not trust them)")
if flg.mean() > 0.5:
    print('Most of them: this star is too bright for SPHEREx (its pixels fill up). Fainter stars give a clean spectrum.')
np.savetxt(out + '_spectrum.csv', np.c_[lam, bw, mjy, flg], delimiter=',', header='lambda_um,bandwidth_um,flux_mJy,flagged', comments='', fmt=['%.5f', '%.5f', '%.3f', '%d'])
print('Spectrum saved:', out + '_spectrum.csv')`],
      ['md', `## Where next
- Compare with ARCNAVE's own cards for this spot (motion measured against Gaia, spectrum with 2MASS and WISE): ${p.url ? `[open it](${p.url})` : 'open ARCNAVE'}.
- IRSA's [SPHEREx tutorial notebooks](https://caltech-ipac.github.io/irsa-tutorials/spherex/) go further (PSFs, spectral images, source catalogues).
- Honest limits: the brightness here is a quick aperture sum (no PSF fit, no flags masked), and the passes are lined up on the images' own sky coordinates, not re-fitted on stars.`],
    ];
  }

  function build(p) {
    const cs = cells(p);
    const src = text => { const L = text.split('\n'); return L.map((l, i) => i < L.length - 1 ? l + '\n' : l); };
    const ipynb = {
      cells: cs.map(([type, text]) => type === 'md' ? { cell_type: 'markdown', metadata: {}, source: src(text) }
        : { cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: src(text) }),
      metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' },
        arcnave: { ra: +p.ra, dec: +p.dec, size: +p.size, band: +p.band, url: p.url || null, version: p.version || null } },
      nbformat: 4, nbformat_minor: 5,
    };
    const py = cs.map(([type, text]) => type === 'md' ? text.split('\n').map(l => ('# ' + l).trimEnd()).join('\n') : text).join('\n\n') + '\n';
    return { ipynb, json: JSON.stringify(ipynb, null, 1), py, file: 'arcnave_' + ((p.name || 'field').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field') };
  }
  return { build, cells };
});
