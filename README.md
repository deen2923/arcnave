<div align="center">

# ARCNAVE

### Watch the sky change. Find what moves.

Real NASA SPHEREx images of any spot in the sky, played as a film, with every mover measured.

[![NASA Space Apps 2026](https://img.shields.io/badge/NASA%20Space%20Apps-2026-0b3d91)](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)
[![Challenge](https://img.shields.io/badge/challenge-Planet%20X%20and%20SPHEREx-14b8a6)](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)
[![Live app](https://img.shields.io/badge/live-arcnave.vldeena2008.workers.dev-2ee6c8)](https://arcnave.vldeena2008.workers.dev)
[![Targets](https://img.shields.io/badge/NASA%20test%20targets-5%20%2F%205-ffb547)](#results-on-nasas-five-test-targets)
[![Dependencies](https://img.shields.io/badge/dependencies-none-555)](#run-it-yourself)

**[Open the live app](https://arcnave.vldeena2008.workers.dev)** ·
**[Project demo (7 slides)](reports/ARCNAVE-Project-Demo-7-slides-v2.pdf)** ·
**[Full project report](reports/ARCNAVE-Full-Report-v0.57.8.pdf)** ·
**[Version history](CHANGELOG.md)**

<img src="reports/src/shots-full/20-film-barnard.jpg" alt="ARCNAVE film of Barnard's Star: the star circled in every SPHEREx pass" width="900">

<sub>Barnard's Star in real SPHEREx images: circled in every pass, its measured track drawn across the passes.</sub>

</div>

---

## In one minute

Type any RA/Dec or a star's name. ARCNAVE fetches every real SPHEREx image of that spot from NASA/IPAC IRSA, lines the
images up on ESA Gaia DR3 stars and plays the passes in time order, like a little video. Anything that moves or changes stands out. Each mover
is circled pass by pass, measured in arcseconds per year, and checked against Gaia DR3, NASA CatWISE2020 and the
known-asteroid services. Every result says how sure it is. Nothing is called a discovery.

| | |
|---|---|
| **5 / 5** | NASA test targets answered with measured numbers |
| **12 / 12** | challenge objectives covered |
| **8 / 8** | challenge resources used |
| **19,880** | fake planets hidden in real images to test it |
| **4 MB of 65 MB** | read per SPHEREx image: only the rows the field needs |
| **4 languages** | English, Tamil, Hindi, Spanish, with narration |

---

## Results on NASA's five test targets

Measured by ARCNAVE on real SPHEREx images (QR2 + QR3). Each target opens in one click.

| Target | Measured by ARCNAVE | Reference | Verdict | Open it |
|---|---|---|---|---|
| Barnard's Star | 9.7″ north in 359 days (9.9″/yr) | catalogue 10.2″/yr | ✅ Motion seen | [▶ open](https://arcnave.vldeena2008.workers.dev/#ct=barnard) |
| Epsilon Indi B | 4.3 ± 0.3″/yr south-east over 4 passes | catalogue 4.7″/yr | ✅ Motion seen | [▶ open](https://arcnave.vldeena2008.workers.dev/#ct=epsindb) |
| WISE 0855−0714 | 8.82 ± 1.10″/yr west, AB 17.15 at 11.8σ | CatWISE2020 7.94″/yr | ✅ Agrees | [▶ open](https://arcnave.vldeena2008.workers.dev/#ct=wise0855) |
| RW Aurigae | faded 0.74 mag, Sep 2025 → Sep 2026, in 6 of 6 colours | comparison stars steady to 0.13 mag | ✅ Change seen | [▶ open](https://arcnave.vldeena2008.workers.dev/#ct=rwaur) |
| R Draconis | changed 1.24 mag at 0.85 µm over 10 images | comparison stars steady to 0.12–0.13 mag | ✅ Change seen | [▶ open](https://arcnave.vldeena2008.workers.dev/#ct=rdra) |

<table>
<tr>
<td width="50%"><img src="reports/src/shots-full/10-target-barnard.jpg" alt="Barnard's Star target card"><br><sub>Barnard's Star: what NASA expects, what ARCNAVE measured, "How sure are we?"</sub></td>
<td width="50%"><img src="reports/src/shots-full/30-target-wise0855.jpg" alt="WISE 0855 target card"><br><sub>WISE 0855, the coldest known brown dwarf: motion measured, CatWISE2020 agrees.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/32-target-rwaur.jpg" alt="RW Aurigae light curve"><br><sub>RW Aurigae: the fade measured in every colour against steady comparison stars.</sub></td>
<td><img src="reports/src/shots-full/32-target-rdra.jpg" alt="R Draconis brightness change"><br><sub>R Draconis: a pulsating giant, its change measured at 0.85 µm.</sub></td>
</tr>
</table>

---

## How far you can trust it

Four tests on 18 sky fields chosen on a grid before any run (along the ecliptic every 60°, on it and 40° above and
below). Fields where ARCNAVE does badly stay in the tables. Open them live with [`#scorecard`](https://arcnave.vldeena2008.workers.dev/#scorecard).

| Test | What it does | Result |
|---|---|---|
| **Hide Planet X** | 19,880 fake planets hidden in real SPHEREx images, then searched for, with and without a motion-following stack | Planet at **1,000 AU found in 18 of 18 fields** (median faintest V ≈ 17); at 300 AU in 12 of 18 |
| **Brightness** | stars made brighter by known amounts | 1.5× brighter caught in **82% of 720 stars**; 2× in **89%** |
| **False alarms** | two stacks of the same passes that differ in nothing real, so every change reported is false | away from the Milky Way: 22 false alarms in 32 comparisons, 7 of 12 fields with none; crowded Milky Way fields give more, and the app warns |
| **Movers** | fake movers of known speed and brightness injected and measured | recovery reported cell by cell, by speed and signal |
| **PSF** | ARCNAVE's star shape, built from each image's own stars, compared with the official SPHEREx PSF | checked in `test/psf.official.test.js` |

<table>
<tr>
<td width="50%"><img src="reports/src/shots-full/40-hide-planet-x.jpg" alt="Hide Planet X test"><br><sub>Hide Planet X: hide a fake planet in real images and see if the search finds it.</sub></td>
<td width="50%"><img src="reports/src/shots-full/41-scorecard.jpg" alt="Validation scorecard"><br><sub>The scorecard: every test, field by field, misses included.</sub></td>
</tr>
</table>

---

## What you see

<table>
<tr>
<td width="50%"><img src="reports/src/shots-full/20-film-epsindb.jpg" alt="Film on Epsilon Indi B"><br><sub><b>Play as a video:</b> Epsilon Indi B over four passes, April 2025 to September 2026.</sub></td>
<td width="50%"><img src="reports/src/shots-full/11-mode-blink.jpg" alt="Blink mode"><br><sub><b>Blink:</b> flip between passes, the way Tombaugh found Pluto.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/11-mode-diff.jpg" alt="Difference view"><br><sub><b>Subtract:</b> what changed between passes.</sub></td>
<td><img src="reports/src/shots-full/11-mode-change.jpg" alt="Changes map"><br><sub><b>Changes:</b> brightenings, fadings and movers, coloured by epoch and explained in words.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/12-gaia-overlay.jpg" alt="Gaia DR3 overlay"><br><sub><b>Gaia DR3 overlay:</b> stars at the date of the pass, arrows for their motion.</sub></td>
<td><img src="reports/src/shots-full/31-wise-overlay.jpg" alt="CatWISE2020 overlay"><br><sub><b>CatWISE2020 overlay:</b> movers and very red sources Gaia cannot see.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/33-spectrum.jpg" alt="Spectrum of a star"><br><sub><b>Spectrum:</b> ~100 colours from 0.75 to 5 µm, checked against 2MASS and AllWISE.</sub></td>
<td><img src="reports/src/shots-full/15-deep-view.jpg" alt="Deep view"><br><sub><b>Add up images:</b> every image of each of the 6 detectors added together.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/14-flags.jpg" alt="Pipeline flags"><br><sub><b>NASA pipeline FLAGS</b> shown on the image: saturation, ghosts, cosmic rays.</sub></td>
<td><img src="reports/src/shots-full/44-known-asteroid.jpg" alt="Known asteroid"><br><sub><b>Known asteroids</b> named and tracked (SkyBoT, Minor Planet Center, JPL Horizons).</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/18-spherex-dr1-sky.jpg" alt="SPHEREx DR1 sky"><br><sub><b>SPHEREx's own sky:</b> the DR1 all-sky map as the base layer.</sub></td>
<td><img src="reports/src/shots-full/16-elsewhere.jpg" alt="This spot elsewhere"><br><sub><b>This spot elsewhere:</b> CSA NEOSSat's own pictures of the same spot, via CADC.</sub></td>
</tr>
<tr>
<td><img src="reports/src/shots-full/03-landing-tamil.jpg" alt="Tamil start page"><br><sub><b>Four languages:</b> the start page in Tamil (also Hindi, Spanish, English).</sub></td>
<td><img src="reports/src/shots-full/50-game.jpg" alt="Find the asteroid game"><br><sub><b>Find the asteroid:</b> a 60-second game on real SPHEREx images.</sub></td>
</tr>
</table>

<p align="center">
<img src="reports/src/shots-full/60-phone-landing.jpg" alt="ARCNAVE on a phone" width="260">
&nbsp;&nbsp;
<img src="reports/src/shots-full/61-phone-target.jpg" alt="A target on a phone" width="260">
<br><sub>Works on phones.</sub>
</p>

---

## What you can take away

| Output | What it is |
|---|---|
| **GIF / WebM** | the video of the spot, movers circled |
| **Movers CSV / JSON** | every mover with its positions, motion and errors |
| **Python notebook** | a Jupyter notebook that redoes the work for the spot with Astropy/astroquery |
| **Copy Python** | the same steps as a short script |
| **Link and embed** | `#ra=…&dec=…` links, `?embed=1`, "Copy embed code" |
| **Discovery card** | a shareable card for what you found, marked "unconfirmed" |
| **Candidate report** | Backyard Worlds checks done for a candidate: seen again, known asteroid, Gaia/CatWISE match, NASA flags |

---

## How it works

```
FIND      IRSA TAP lists every SPHEREx image of the spot (QR2, QR3, DR1)
READ      only the field's rows of each 65 MB image (~4 MB), from NASA's open copy on AWS S3
CLEAN     NASA pipeline FLAGS and zodiacal light removed
MATCH     images of the same colour in every pass
ALIGN     every image registered on ESA Gaia DR3 stars moved to its date
MEASURE   empirical PSF fits per image, a straight-line motion through the passes
CHECK     Gaia DR3, CatWISE2020, SkyBoT / MPC / JPL Horizons, "How sure are we?"
```

New SPHEREx releases appear by themselves: the archive search has no release filter, and DR1 (November 2026) showed up
with no code change.

---

## Run it yourself

Needs Node.js 18+ and internet. No `npm install`.

```bash
node server.js
```

Then open `http://localhost:8080`. On Windows, double-click `start.bat` (opens `http://localhost:8083`).

Tests: `node test/test.js` (offline), `node test/real.test.js` (real SPHEREx fixtures), `node test/real.e2e.js` (the whole
app in a browser). Deploying your own copy: [DEPLOY-CLOUDFLARE-ONLY.md](DEPLOY-CLOUDFLARE-ONLY.md) or [DEPLOY.md](DEPLOY.md).

---

## Data and credits

**NASA:** SPHEREx (QR2, QR3, DR1) via NASA/IPAC IRSA and AWS S3 · SPHEREx tutorial notebooks · NASA WISE (CatWISE2020,
AllWISE) · 2MASS · JPL Horizons · WiseView / Backyard Worlds.
**Space agency partners:** ESA Gaia DR3 · CSA NEOSSat via CADC.
**Other:** IMCCE SkyBoT · Minor Planet Center · CDS (Aladin Lite, Sesame, SIMBAD, VizieR, HiPS).
Full credits: [`public/about.html`](public/about.html).

**Team ARCNAVE:** VL Deenadayalan · Gokulraj B · Kishore R · Akash B · Aswin V · Sabari Vignesh S

<sub>Use of AI, as the Space Apps rules ask: an AI coding assistant helped write the code, and the tour narration uses
neural text-to-speech voices. The idea, the method and every number are the team's, measured by this code on real
archive data.</sub>
