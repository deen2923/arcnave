# Measure every frame, then fit one line

**Short answer.** ARCNAVE should not copy asteroid-hunting tools. It should copy the way CatWISE measures star motion. First, correct each image's sky position using Gaia stars. Next, measure the star's position in every image with a small PSF fit. Then group the images by pass and fit one straight line through all the positions. That line is the measured path, and every frame adds one dot to it. This plan answers all three goals: (1) it finds movers frame by frame, (2) it reaches fainter stars because it uses the signal from all images together, and (3) it draws a real path. After that, two add-ons help with faint stars: same-band "dipole" difference images, and a small trial-motion scan around each source. Both run in plain JavaScript in seconds. Three limits matter most. Most bright nearby stars are **saturated in SPHEREx (about 9.7–11.7 AB mag)**. One pass lasts about two weeks, so the dots within one pass sit in a tight cluster. Real motion shows up only between passes. Professional motion searches show that almost every candidate is either a known mover or an artefact. So ARCNAVE should say "known mover" or "candidate", never "discovery". Planet Nine / Planet X is hypothetical, and this tool cannot test for it.

**How to read this report.** A sentence with a link is a **cited fact** from a source. A sentence that starts with "*Estimate:*" is my own calculation or judgement, built from those facts. No source has published a SPHEREx proper-motion study yet, so every SPHEREx motion limit below is an estimate.

## SPHEREx sees each sky spot for two weeks, every six months

First, the facts about the data. Images have **6.15" pixels** ([Akeson et al.](https://arxiv.org/html/2511.15823v2)). The mission paper rounds this to 6.2" ([Bock et al. 2025](https://arxiv.org/abs/2511.02985)). The point spread function (PSF) is the blur shape of one star. Before launch, it was **under 3" wide over most of the short-wavelength focal plane**. It grows to **about 5.5" at the longest wavelengths** ([Bock et al.](https://arxiv.org/html/2511.02985)). So the PSF is often smaller than one pixel. Scientists call this "undersampled". Each detector has a filter whose wavelength changes along one side of the image. So **each image of a star is at a different wavelength**, and there are **102 channels** in total ([Bock et al.](https://arxiv.org/html/2511.02985)).

Timing is the key fact for "frame by frame" tracking. **One object gets all its channels within about two weeks per survey**. There are **four all-sky surveys in about two years**, and each takes about six months ([Bock et al.](https://arxiv.org/html/2511.02985)). *Estimate:* Barnard's Star moves about 10"/yr, so it moves at most about 0.4" inside one pass. That is less than one tenth of a pixel. So the frames inside one pass do not show motion. They are many repeated measurements of almost the same position. The motion appears **between** passes. This is good news, not bad news. The many frames in a pass let ARCNAVE measure its own error honestly, and they let it reject one-frame artefacts. CatWISE uses the same idea: WISE exposures in one epoch span only about two days, so CatWISE treats them as one moment in time ([Eisenhardt et al. 2020](https://ar5iv.arxiv.org/html/1908.08902)).

One place is different. Two fields of about **100 square degrees near the ecliptic poles are observed every orbit**. They get **more than 400 observations per channel over two years** ([Bock et al.](https://arxiv.org/html/2511.02985)). *Estimate:* there, the path really is a smooth time series. A mover there would show a visible drift through many frames. That makes these fields the best test bed for "path through every frame".

The table below gives depth and brightness limits.

| Quantity | Value | Type |
|---|---|---|
| 5σ point-source depth, 4 surveys, 0.75–3.8 µm | 19.5–19.9 AB per channel | Cited ([Bock et al.](https://arxiv.org/html/2511.02985)) |
| 5σ depth, 4 surveys, 3.8–5.0 µm | 17.8–18.8 AB per channel | Cited ([Bock et al.](https://arxiv.org/html/2511.02985)) |
| Saturation | about 11.7–9.7 AB across bands | Cited ([POKEMON-DLC](https://arxiv.org/pdf/2604.22983)) |
| Brown dwarfs with S/N ≳10 per channel | W2 ≲ 14.0 Vega | Cited ([SPIFF](https://arxiv.org/html/2604.22012)) |
| Image alignment to Gaia (released images) | median 0.1–0.4" | Cited ([Akeson et al.](https://arxiv.org/html/2511.15823v2)) |
| Depth of one pass | about 0.75 mag shallower than 4 surveys (≈18.8–19.2 AB in bands 1–4, ≈17–18 AB in bands 5–6) | *Estimate* (√N scaling) |
| Depth of one single image | shallower again, by up to about 0.75 mag | *Estimate*; no published number found |

Cold brown dwarfs are brightest at **3.9–5 µm (bands 5–6)**. For the coldest known one, WISE 0855−0714, **only flux redward of 3.9 µm is detected reliably** ([arXiv:2607.00543](https://arxiv.org/html/2607.00543)). So ARCNAVE should search for brown dwarfs mainly in bands 5–6. Bright stars like Barnard's Star are saturated. This matches what ARCNAVE already sees: saturated stars give rough results.

## Asteroid tools fail here; a straight-line fit wins

Planet and asteroid searches use two big methods. The notes show that neither one fits ARCNAVE well.

**Shift-and-stack.** This method adds images along many trial motions. Signal-to-noise then grows like √N, where N is the number of images ([Shao et al. 2014](https://ar5iv.arxiv.org/html/1309.3248)). KBMOD gets about **1 mag deeper with 6 images and 2 mag deeper with 40** ([Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)). But it tests billions of trial paths, so it needs strong false-alarm controls. These include a 10σ threshold, outlier removal, stamp-shape filters, and a final check by eye ([Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492); [Smotherman et al. 2021](https://ar5iv.arxiv.org/html/2109.03296)). *Estimate:* ARCNAVE has only 2–4 passes, so stacking passes gains just **+0.38 mag for 2 passes and +0.75 mag for 4**. Also, a 10"/yr star moves only about **2.4 pixels over 1.5 years**. So a plain static stack of all passes already holds most of a mover's light. Shift-and-stack only helps a little here.

**Tracklet linking.** MOPS, HelioLinC3D and THOR link many detections over many nights into orbits. HelioLinC3D needs **at least 3 tracklets from different nights within 14 days** ([Rubin DP1](https://dp1.lsst.io/processing/moving/ss_linking.html)). THOR needs **at least 5 observations** ([Moeyens et al. 2021](https://arxiv.org/pdf/2105.01056)). Stars move in a straight line, so ARCNAVE only needs 4 numbers: start x, start y, and motion in x and y. *Estimate:* the search radius is small (at most about 15"), so the matching is easy.

**The CatWISE way.** CatWISE detects sources once, on a deep stack. Then it fits **position and proper motion together across all epoch images** ([Eisenhardt et al. 2020](https://ar5iv.arxiv.org/html/1908.08902)). This reaches **about 20 mas/yr at W1≈15 and about 100 mas/yr at W1≈17**, but it uses a baseline of 8+ years and 12 epochs ([Marocco et al. 2021](https://ar5iv.arxiv.org/html/2012.13084)). It also warns that fast movers get smeared in deep stacks. **WISE 0855−0714 appears five times** in CatWISE2020 ([Marocco et al. 2021](https://ar5iv.arxiv.org/html/2012.13084)). The Planet Nine searches with WISE gave the clearest lesson. **Of 2,735 linked candidates, 737 were known high proper-motion stars, and all the other 1,998 were rejected after checking by eye. Zero real candidates remained** ([Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)).

The ARCNAVE method today is like a two-epoch version of this. It uses cross-correlation on bright peaks from pass 1 only. Its ≥2" threshold makes sense for 6" pixels. But it misses faint stars for three reasons. It starts from the 120 brightest peaks only. It compares patches instead of fitting a PSF. And it does not use the many frames within each pass.

## Ranked plan: seven steps, in order

The ranking puts the base work first: each later step needs the earlier ones. All compute costs are *estimates* for plain JavaScript on a cutout of about 300×300 pixels. No source gives measured JavaScript speeds.

| Rank | What to build | Goal it serves | Browser cost (*estimate*) |
|---|---|---|---|
| 1 | Per-frame Gaia re-registration | All three | well under 1 s per field |
| 2 | Per-frame PSF centroid with flag mask and saturated-star wing fit | 1, 3 | microseconds per star |
| 3 | Per-pass grouping + weighted straight-line fit + χ² test | 1, 3 | trivial |
| 4 | Detect on a deep all-pass stack (bands 5–6 for brown dwarfs), down to S/N ≈5 | 2 | under 1 s |
| 5 | Same-band difference images with dipole / translient scoring | 2 | tens of ms per image pair |
| 6 | Trial proper-motion scan around each source (KBMOD Psi/Phi) | 2, 3 | under 2 s (121 trials) to 5–20 s (1,681 trials) |
| 7 | Add CatWISE2020 and 2MASS cross-match for stars that Gaia cannot see | labelling | one query per field |

### Rank 1: correct each frame's position with Gaia stars

The released images already have a fit to Gaia. But the alignment error is still **0.1–0.4"** ([Akeson et al.](https://arxiv.org/html/2511.15823v2)). That is close to the motion ARCNAVE wants to see. A discovery paper re-registered every epoch to Gaia. It used about **700 unsaturated reference stars with 3σ clipping** ([Marocco et al. 2019](https://ar5iv.arxiv.org/html/1906.08913)). ARCNAVE should do the same in every frame. First, move each Gaia DR3 star from its **epoch J2016.0** ([Gaia DR3 datamodel](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)) to the frame date. Then match the stars and fit a small affine correction (shift, rotation, scale). Use only stars that are not saturated and not crowded. *Estimate:* this removes most fake motion that comes from image alignment.

### Rank 2: measure a position in every frame, the careful way

On undersampled pixels, a simple centroid is biased by where the star falls inside the pixel. The proven fix is the effective PSF (ePSF). It reached **0.02 pixel per star per image** on HST ([Anderson & King 2000](https://arxiv.org/abs/astro-ph/0006325)). SPHEREx gives an ePSF with each image: **33×33 arrays, 5× oversampled, on 21×21 zones**, and IRSA recommends it ([IRSA data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products)). *Estimate:* the cheapest good version in JavaScript is a pixel-integrated Gaussian fit on a 5×5 or 7×7 window, solved with Levenberg-Marquardt. It needs about 50 lines of code. Later, ARCNAVE can switch to the official ePSF.

Before fitting, remove bad pixels using the FLAGS plane. That means transients, persistence, ghosts, saturation, nonfunctional and dichroic pixels ([Akeson et al.](https://arxiv.org/html/2511.15823v2)). For saturated stars, never use the peak. Fit the PSF only to the unsaturated wings, and mark the result "saturated: wing-fit" with a larger error. Professional pipelines also struggle with bright stars. CatWISE used a **wider 5.5" match radius** for them ([Eisenhardt et al. 2020](https://ar5iv.arxiv.org/html/1908.08902)).

### Rank 3: group by pass, fit a line, draw the path

In each pass, average the frame positions with weights. The spread between frames gives an honest error for that pass. *Estimate:* then fit position = start + motion × time with weighted least squares across the passes. Report the motion, its error σμ, and χ². With 3 passes, χ² has 2 degrees of freedom, so accept a source if χ² < 9.2. With 4 passes it has 4, so accept if χ² < 13.3. Call a motion significant only if **μ/σμ ≥ 5**. With only 2 passes, a χ² test is not possible. Then label the result "two-epoch displacement".

**How to draw it.** Draw one small dot per frame, coloured by pass. Add one error ellipse per pass, and the fitted straight line. Next to the plot, show a "blink" of the cutouts from each pass. Professional teams still check every candidate by eye. Backyard Worlds found its first brown dwarf this way, using flipbooks ([Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)).

*Parallax note (estimate):* passes six months apart are seen from opposite sides of Earth's orbit. For stars closer than about 5 pc, this shift can be around 1". With only 2–4 passes, ARCNAVE should not fit parallax freely. One discovery paper got an impossible negative parallax when it tried (**−100 ± 440 mas**) ([Marocco et al. 2019](https://ar5iv.arxiv.org/html/1906.08913)). Use Gaia's parallax when Gaia has one, or compare passes one year apart.

### Rank 4: find more sources before tracking them

Today ARCNAVE starts from the 120 brightest peaks in pass 1. Instead, detect sources on a deep stack of all passes and all frames. For brown dwarfs, build a separate stack from bands 5–6 only. Go down to about S/N 4–5. The unTimely catalogue detects at **S/N 4.0 in W1 and 2.5 in W2** on each epoch ([Meisner et al. 2023](https://arxiv.org/abs/2209.14327)). *Estimate:* fast movers smear a little in this stack, but SPHEREx movers shift only about 2 pixels at most, so the stack still finds them. Then use Ranks 2–3 at the known position in every frame. This is called forced fitting. It measures stars that are too faint to detect in one frame alone. Do not use the fixed "5× field scatter" rule. Instead, compare each star with field stars of **similar brightness**, because fainter stars naturally scatter more.

### Rank 5: difference images for faint, slow movers

When a star moves less than about one PSF width, a difference image shows a **"dipole"**: a negative spot next to a positive spot. A bigger move shows two separate spots, called a "mover" ([Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)). Rubin's notes warn that a fit to the difference image alone cannot measure separation below about one PSF sigma. Adding the original images to the fit helps a lot ([DMTN-007](https://dmtn-007.lsst.io/)). The **translient** statistic is designed for small shifts. It beat ZOGY for shifts of **0.8–1.4 pixels**. It also tells motion apart from brightness change: for motion its score Zσ is larger than |S|, and for a variable star |S| is larger ([Springer et al. 2024](https://arxiv.org/html/2403.09771v1)).

Subtract only images from the **same band with the closest wavelength**, and let the brightness scale be free. Brown dwarf brightness changes strongly with wavelength. *Estimate:* the simplest start is a small Bramich delta-function kernel. Bramich's kernel handles sub-pixel shifts well ([Bramich 2008](https://ar5iv.labs.arxiv.org/html/0802.1273)). *Estimate:* a 5σ dipole needs a star with S/N ≈ 17 if it moved a quarter of the PSF width, and S/N ≈ 42 if it moved one tenth. So this step helps medium-faint stars, not the very faintest.

### Rank 6: a small trial-motion scan around each source

KBMOD computes two maps per image, Psi and Phi, just once. Then each trial motion is only a few lookups and sums. The S/N of a trial is ν = ΣPsi / √ΣPhi ([Whidden et al. 2019](https://ar5iv.arxiv.org/html/1901.02492)). *Estimate:* make one Psi/Phi map per pass, then scan ±10"/yr around each source. A 2"/yr step gives 121 trials and takes under 2 s in a Web Worker. A 0.5"/yr step gives 1,681 trials and takes about 5–20 s. The peak gives a motion estimate, and the shape of the peak gives an error map. Run this per source, not as a blind search over every pixel. A blind search tests many more trials, so it raises false alarms.

### Rank 7: catalogues for stars Gaia cannot see

Gaia's faint limit is about **G≈21** ([ESA Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3)). Y dwarfs such as WISE 0855 are missing or very faint there. For those, use CatWISE2020. Its positions are at **MJD 57170 (~2015.4)** and it gives motions to about W1 17 ([IRSA CatWISE docs](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/gator_docs/CatWISE2020README_IRSA.txt); [Marocco et al. 2021](https://ar5iv.arxiv.org/html/2012.13084)). Also use 2MASS for a long baseline. "No Gaia match" for a red, faint mover is expected. It is not a sign of anything new.

## Expected limits: bright stars near 1–2"/yr, faint stars near 8–13"/yr

*All numbers in this section are estimates.* They assume Ranks 1–3 are in place, and that the error of a motion is about √2 × the pass error, divided by the time between passes.

| Star type | Error per pass | Smallest motion (3σ), 6-month baseline | 1 year | 1.5 years |
|---|---|---|---|---|
| Bright, not saturated (≈13–17 AB) | 0.2–0.3" | 1.7–2.5"/yr | 0.8–1.3"/yr | 0.6–0.8"/yr |
| Faint (S/N ≈5–10 per image) | 1–1.5" | 8–13"/yr | 4–6"/yr | 3–4"/yr |
| Pixel blink, no PSF fit | — | ≥12"/yr | ≥6"/yr | ≥4"/yr |

The table uses 3σ, but Rank 3 asks for 5σ before calling a motion significant. So multiply these limits by about 1.7 for the label rule. The table shows two things. First, waiting for more passes helps more than any clever algorithm, because the error shrinks with the time between passes. Second, for faint stars, a motion of about 3–4"/yr after 1.5 years is the realistic floor. The tool should always show σμ. It should never suggest a precision it does not have.

Some known test targets (motions are general values; check them in SIMBAD). **WISE 0855** (about 8"/yr, bands 5–6 only) needs stacked band 5–6 frames and about a one-year baseline. **ε Indi B** (about 4.7"/yr) is close to a saturated primary star. **Luhman 16AB** (about 2.8"/yr) is bright, and its two stars blend into one source at this pixel size. **SPIFF's 6,003 L–Y dwarfs with known motions** ([SPIFF](https://arxiv.org/html/2604.22012)) are a ready-made test set for checking ARCNAVE's measured motions.

## False alarms: what fakes motion, and how to label it

The published list of fakes is the same across surveys. It includes partly subtracted stars, cosmic rays, ghosts, latent images (persistence) and blends ([Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)). Variable stars can also create **"spurious motion"** ([Marocco et al. 2019](https://ar5iv.arxiv.org/html/1906.08913)). SPHEREx flags about **1.1% of pixels as transients**. It also models and flags persistence ([Bock et al.](https://arxiv.org/html/2511.02985)). In early QR2 data, though, about half of the observations were under-flagged ([arXiv:2607.00543](https://arxiv.org/html/2607.00543)).

*Recommended checks, in order (estimate/synthesis):*

1. Mask flagged pixels.
2. Require the source in at least 2–3 frames in **each** pass, pointing the same way. Cosmic rays and ghosts do not repeat.
3. With 3–4 passes, require a straight line (the χ² test).
4. In difference images, require equal positive and negative flux. Unequal lobes mean a variable star.
5. Stay away from bright stars, by a distance that grows with their brightness.
6. Use one data release (QR2 or QR3) for all passes of a field.
7. Compare with Gaia, moved to each pass date.

ARCNAVE's control fields with no false flags are a good start. Every new step should be re-tested on those control fields.

**Labelling rules.** Use only these labels: **"Known mover"** (with catalogue ID, catalogue motion vs measured motion), **"Motion candidate — needs confirmation"** (with number of passes, μ ± σμ, χ²), **"Two-epoch displacement"** (2 passes only), **"Likely artefact"**, and **"Gaia says it hardly moves"**. Never use "discovery" or "new object". In real surveys, a candidate becomes a discovery only after independent epochs and **spectroscopy**. Backyard Worlds' first brown dwarf needed an IRTF spectrum ([Kuchner et al. 2017](https://ar5iv.arxiv.org/html/1705.02919)). If a measured motion disagrees with Gaia, the cause is a measurement problem (blend, saturation). It is not a new object. For **Planet Nine / Planet X**, say clearly that it is hypothetical. The deep WISE searches found **no plausible candidate** ([Meisner et al. 2017](https://arxiv.org/abs/1611.00015)). Objects at hundreds of AU move mostly because Earth moves, not in a straight line ([Meisner et al. 2018](https://ar5iv.arxiv.org/html/1712.04950)). This tool cannot test for them.

**Open gaps.** These things are still unknown:

- No SPHEREx paper has measured proper motions yet.
- No measured in-flight PSF width per band was found.
- No single-image depth was found.
- The exact FLAGS bit numbers are in a document that could not be read: Explanatory Supplement Table 10.
- The exact time gaps between frames inside one pass were not found.

Check these before fixing thresholds in code.

## Conclusion

The main change is in how ARCNAVE thinks about the frames. Today it compares the first pass with the later passes. Instead, it should treat the many frames in a pass as repeated measurements, and treat the passes as the points on a straight line. With this view, "frame by frame" tracking and "fainter movers" become one task. Each frame adds a little evidence. The straight-line fit across passes turns that evidence into a motion with an honest error. The drawn path is then simply that fit, shown on top of the dots it came from.

Time matters more than any clever method. Each new survey pass lowers the motion limit more than any algorithm can. So ARCNAVE should be built to add passes automatically as SPHEREx releases them. It should also show a student, in numbers, how σμ shrinks with each pass. Most of all, it should treat a known mover as a success of the method, not as a missed discovery. This is what the professional searches found too: almost every motion they flagged was a known mover or an artefact.
