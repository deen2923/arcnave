"""Independent check of ARCNAVE's own sky maths against Astropy (used for validation only; the web tool itself is JavaScript).
Usage: python tools/astropy_check.py <SPHEREx cutout .fits> [more files]
1. WCS: ARCNAVE (lib/fits.js, FITS 1-based pixels like CRPIX) vs astropy.wcs (origin=1) on a 9x9 grid of pixels: pixel -> sky and sky -> pixel.
2. Proper motion: the predicted position of a moving target on a date, ARCNAVE's flat formula (ctAt in public/app.js) vs
   astropy SkyCoord.apply_space_motion, for the NASA challenge targets, in arcseconds.
"""
import json, subprocess, sys, os, warnings
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u
warnings.filterwarnings('ignore')
here = os.path.dirname(os.path.abspath(__file__))
for path in sys.argv[1:]:
    ours = json.loads(subprocess.check_output(['node', os.path.join(here, 'astropy_check.js'), path]))
    with fits.open(path) as h:
        w = WCS(h['IMAGE'].header)   # the same IMAGE extension; SIP / TAN as in the header
        P = ours['pts']; x = np.array([p['x'] for p in P]); y = np.array([p["y"] for p in P])
        ra, dec = w.all_pix2world(x, y, 1)
        c0 = SkyCoord(ra * u.deg, dec * u.deg); c1 = SkyCoord([p['ra'] for p in P] * u.deg, [p['dec'] for p in P] * u.deg)
        d_sky = c0.separation(c1).arcsec
        bx, by = w.all_world2pix([p["ra"] for p in P], [p["dec"] for p in P], 1)
        d_pix = np.hypot(bx - np.array([p['bx'] for p in P]), by - np.array([p['by'] for p in P]))
        print(f"{os.path.basename(path)}: {len(P)} pixels, pixel->sky max {d_sky.max():.3f}\" (median {np.median(d_sky):.3f}\"), "
              f"sky->pixel max {d_pix.max():.3f} px; SIP in header: {'A_ORDER' in h['IMAGE'].header}")
# proper motion: ARCNAVE's ctAt: ra0 + pmra/3.6e6*dy/cos(dec0), dec0 + pmdec/3.6e6*dy, dy in years from the epoch MJD
T = {  # name: ra0, dec0, epoch MJD, pmra* (mas/yr, includes cos dec), pmdec (mas/yr) -- the values in CHALLENGE in public/app.js
  "Barnard's Star": (269.452077, 4.693365, 51544.5, -801.551, 10362.394),
  "Epsilon Indi B": (331.04383, -56.782694, 51491.54, 3981.977, -2466.832),
  "WISE 0855": (133.795224, -7.245138, 55320.4, -8123.7, 673.2),
}
mjd = 61040.0
print(f"proper motion to MJD {mjd} (ARCNAVE flat formula vs astropy apply_space_motion):")
for n, (ra0, dec0, ep, pmra, pmdec) in T.items():
    dy = (mjd - ep) / 365.25
    mine = SkyCoord((ra0 + pmra / 3.6e6 * dy / np.cos(np.radians(dec0))) * u.deg, (dec0 + pmdec / 3.6e6 * dy) * u.deg)
    c = SkyCoord(ra0 * u.deg, dec0 * u.deg, pm_ra_cosdec=pmra * u.mas / u.yr, pm_dec=pmdec * u.mas / u.yr, obstime=Time(ep, format='mjd'))
    ap = c.apply_space_motion(new_obstime=Time(mjd, format='mjd'))
    print(f"  {n}: moved {c.separation(ap).arcsec:.2f}\" since the catalogue epoch; ARCNAVE vs astropy differ by {mine.separation(ap).arcsec:.3f}\"")
