# ARCNAVE: NASA Space Apps 2026 submission draft ("Planet X and SPHEREx")

Field by field, in the order of the Space Apps project form (2026 Project Submission Guide). Copy each block into the
form. Everything must be in English. Replace every `<<...>>` before submitting. Deadline: Sunday 15 November 2026,
11:59 pm local time ("Submit for Judging").

How the 2025 Global Winners wrote theirs (read on their project pages, 14 Nov 2026):
- **Summary ~150 words**: what it is, how it answers the challenge, why it matters, in plain words.
- **Project Details** answers the guide's questions with **short headings** (How it works / Benefits & impact / Tools /
  What makes it different), 200-450 words. Resonant Exoplanets (Best Use of Data) and SpaceGenes+ (Best Use of Science)
  both did this.
- **AI section**: a plain list of which tool was used for what, plus "reviewed and tested by the team", "no AI images or
  NASA branding".
- **NASA Data**: specific named datasets and archives, not "NASA data" in general.
- Demo hosted on YouTube or Google Drive; final project = a live web app link.

---

## 1. Project Name
**ARCNAVE: Watch the sky change. Find what moves.**

## 2. High-Level Project Summary (≈185 words)
ARCNAVE is a free public web tool that turns NASA SPHEREx's all-sky infrared survey into something anyone can watch.
Type any sky position (RA/Dec) or a name, and ARCNAVE fetches every real SPHEREx image of that spot from NASA/IPAC IRSA,
lines them up on ESA Gaia stars, and plays the passes like a short film, so moving and changing objects stand out.
Movers are circled pass by pass and measured, then checked against Gaia DR3, NASA WISE (CatWISE2020) and the known
asteroids. It answers every part of the challenge: RA/Dec in, a "little video" out, tested on all five NASA targets,
the 102 colours used for spectra and per-detector deep stacks, add/subtract views, a choice of field of view,
Gaia/WISE overlays, URLs that embed, contamination flags shown, and new data releases picked up automatically
(SPHEREx Data Release 1, published this month, was picked up with no code change). It matters because discoveries in time-domain surveys
come from many eyes: ARCNAVE gives volunteers, students and scientists the same honest, checkable view, in four
languages, on a phone or a laptop, and never calls anything a discovery.

## 3. Link to Project Demo
<<YouTube/Drive link to the ≤30 s video with English subtitles, OR the 7-slide deck (see section 9)>>

## 4. Link to Final Project
https://arcnave.vldeena2008.workers.dev · Code: <<https://github.com/USERNAME/arcnave>>
(Open the five NASA targets directly: `/#ct=barnard`, `/#ct=epsindb`, `/#ct=wise0855`, `/#ct=rwaur`, `/#ct=rdra`.)

## 5. Detailed Project Description (≈530 words)

**What it does.** ARCNAVE is a sky viewer built around SPHEREx's repeated passes over the whole sky. For any spot it
shows the passes as a film, a blink, a swipe, a difference image or a "what changed" map, and it measures what moves.
A guided 90-second story, a "find the asteroid" game and tours with narration make it usable by a 12-year-old; the
measurement cards, uncertainty notes and a Python/Jupyter export make it usable by a scientist.

**How it works (how we use the data).**
1. *Find:* NASA/IPAC IRSA's TAP service (`spherex.plane`, `spherex.artifact`) lists every SPHEREx spectral image covering
   the spot, across releases (QR2, QR3, DR1).
2. *Read only what is needed:* each 65 MB image is read from NASA's open copy on AWS S3 (`nasa-irsa-spherex`) with byte
   ranges, only the rows of the field: about 4 MB instead of 65 MB.
3. *Clean:* the pipeline's own FLAGS bits remove saturation, ghosts, halos, persistence and cosmic rays; the ZODI model
   removes zodiacal light; the per-pixel wavelength map (WCS-WAVE) picks images of the same colour in every pass.
4. *Align:* every image is registered on ESA Gaia DR3 stars, moved to the image's date with Gaia's proper motions.
5. *Measure:* stars are fitted with an empirical PSF in every image; motions come from a straight-line fit through the
   passes, with a field error floor from ~40 steady Gaia stars. Faint movers are searched with a 625-trial motion scan
   (shift-and-stack). Known asteroids come from IMCCE SkyBoT, the Minor Planet Center and JPL Horizons.
6. *Check:* every result is compared with Gaia DR3 or CatWISE2020 and labelled known / target / candidate, with a
   "How sure are we?" note. Spectra (~100 colours, 0.75-5 µm) are checked against 2MASS and AllWISE.

**Results on NASA's five test targets (measured by ARCNAVE on real SPHEREx images).**
Barnard's Star: 9.7″ north in 359 days (catalogue 10.2″). Epsilon Indi B: 4.3 ± 0.3″/yr south-east over 4 passes
(catalogue 4.7″). WISE 0855: 8.82 ± 1.10″/yr west, AB 17.15 at 11.8σ (CatWISE2020: 7.94″, agrees). RW Aurigae: faded
0.74 mag in 6 of 6 colours (comparison stars 0.13 mag). R Draconis: changed 1.24 mag at 0.85 µm.

**How far to trust it (tested on 18 fields chosen before the runs).** 19,880 fake "Planet X" objects hidden in real
images: a planet at 1000 AU found in 18 of 18 fields, at 300 AU in 12 of 18. A false-alarm test (two stacks that differ
in nothing real): 22 false alarms in 32 comparisons away from the Milky Way plane, far more inside it, and the app says so.
Fake brightenings of 1.5× caught in 82% of 720 stars.

**Benefits and what we hope to achieve.** Anyone can check a spot of sky in minutes, with real NASA data and honest
uncertainty; volunteers get the checks Backyard Worlds uses (repeat detection, known asteroid, Gaia/CatWISE match,
pipeline flags) and a ready report; teachers get stories and a game in English, Tamil, Hindi and Spanish.

**Tools.** Node.js (no dependencies) server with disk caching; plain JavaScript front end with Web Workers and Canvas;
Aladin Lite (CDS) sky atlas; FITS reading, WCS, PSF fitting and stacking written by the team; Docker + Caddy for hosting;
Jupyter/Astropy/astroquery export.

## 6. Use of Super Intelligence (SI)  (not shown to judges; indicators in the project are)
- **Code:** we used an AI coding assistant (Claude, Anthropic) to help write, test and review code and documentation.
  The idea, the design choices and the science decisions are the team's; every result is computed by the code from real
  archive data, and every number was checked by running the app. Acknowledged in the README and on the About page.
- **Audio:** the guided-tour narration is AI-generated speech (Microsoft neural text-to-speech) reading our own captions;
  acknowledged on the About page and in `public/audio/ABOUT-THESE-VOICES.txt`.
- **No AI-generated images, video, data or results**, and no NASA branding in any generated content.

## 7. NASA Data
- **SPHEREx** spectral images (Level 2), Quick Releases QR2 (DOI 10.26131/IRSA652) and QR3 (10.26131/IRSA662), and Data
  Release 1 (10.26131/IRSA678), via NASA/IPAC IRSA (TAP) and the AWS Open Data copy `s3://nasa-irsa-spherex`.
- **SPHEREx DR1 all-sky data cube** (HiPS, IRSA), shown as a base sky that follows the colour slider.
- **NASA WISE / CatWISE2020** catalogue (IRSA): motions of cool brown dwarfs that Gaia cannot see.
- **2MASS** and **AllWISE** photometry (IRSA) to check SPHEREx spectra.
- **JPL Horizons** (asteroid orbits) and NASA/IPAC IRSA services (MOST, Finder Chart, SPHEREx tutorials and Data Explorer).
- Gaia DR3 at **STScI MAST** (third source) and IRSA's Gaia copy.

## 8. Space Agency Partner Data and Other References
- **ESA Gaia DR3** (alignment and motions), via IRSA, CDS VizieR and STScI MAST.
- **CSA NEOSSat** observations via the **Canadian Astronomy Data Centre** (CADC TAP), shown for the spot on screen.
- IMCCE **SkyBoT** and the IAU **Minor Planet Center** (known asteroids); **CDS** Aladin Lite, HiPS surveys (2MASS, AllWISE,
  DSS2), Sesame, SIMBAD, VizieR; Legacy Surveys, Pan-STARRS, WiseView and Backyard Worlds (links for checking).
- Software: Node.js, Aladin Lite 3.8.2, Docker, Caddy; Microsoft neural TTS (narration).
- Acknowledgement: "This publication makes use of data products from the Spectro-Photometer for the History of the
  Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory
  and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration."
  Full credits: About page.

---

## 9. Demo (choose one; English)

**Option A: 7 slides (title and intro count).**
1. **Title:** ARCNAVE: Watch the sky change. Find what moves. Team, challenge name, live link, QR code.
2. **The problem:** SPHEREx maps the whole sky every six months in 102 colours; movers hide in billions of sources. Pluto
   was found by blinking two plates; we bring that to everyone.
3. **What ARCNAVE does:** type RA/Dec → real SPHEREx passes play as a film → movers circled and measured. One screenshot.
4. **How we use the data:** IRSA search → S3 rows only → FLAGS/ZODI cleaning → Gaia alignment → PSF fits →
   checks vs Gaia/WISE/asteroids. One diagram.
5. **NASA's five targets:** the five measured results vs catalogue (table above).
6. **Honest by design:** 18 test fields, 19,880 fake planets, false-alarm and brightness tests, "How sure are we?".
7. **For everyone + what's next:** 4 languages, phone, game, notebook export; next: DR1 re-measurement, more volunteers.

**Option B: ≤30 s video (English subtitles if spoken in another language).**
- 0-5 s: "SPHEREx photographs the whole sky every six months. What moved?" (landing page)
- 5-15 s: type Barnard's Star → the film plays, the star is circled pass by pass, "9.7″ north in a year".
- 15-24 s: Epsilon Indi B card, WISE overlay arrows, "checked against Gaia and WISE".
- 24-30 s: "Free, four languages, real NASA data. ARCNAVE." + live link on screen.

## 10. Before you click "Submit for Judging"
- [ ] Live link opens on a phone on mobile data, no login.
- [ ] GitHub repository public; README "For judges" has the live link filled in.
- [ ] Demo link public (YouTube unlisted or Drive "anyone with the link").
- [ ] (Recommended by the guide) FortiGuard Web Filter Classification requested for the live site, category
      "Education" or "Web-based application", Company Name "N/A".
- [ ] No images or voices of anyone under 18 in the demo.
- [ ] Ask the Local Lead whether work started before 14 November is fine ("Confirm All Work is Original").
- [ ] After submitting: no more deploys (freeze the code for judging).
