/* ARCNAVE v0.35: a few pixels around ONE star from a SPHEREx file on S3, as fast as possible (spectra on the fly).
   The field cutout (s3cut.js) walks every header of a file (about 6 requests one after the other) and reads full rows of
   IMAGE, FLAGS and ZODI for the whole field. Measured live on 122 files of one pass: 150 s, 92 MB. For one star we need
   ~17 rows of IMAGE and FLAGS only, and files of the same data release and detector share their header layout, so:
     round 1: the IMAGE header, at the offset learned from the first file of that release + detector
     round 2: the rows around the star (IMAGE, and FLAGS rows or, for compressed QR3 FLAGS, the row index)
     round 3: (QR3 only) the compressed FLAGS rows
   If a header is not where expected the full walk (s3cut.layout) is done and its offsets are learned again.
   QR3 files store FLAGS tile-compressed (RICE_1, one tile per row); riceDecode() decodes it (cfitsio's algorithm).
   Zodiacal light needs no ZODI layer here: the photometry subtracts the local sky around the star.
   Works in Node and in the browser. get(start, end) -> Promise<{ buf: Uint8Array, total }>. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fits'), require('./s3cut'), require('./wave'));
  else root.SkySpot = factory(root.SkyFits, root.S3Cut, root.SkyWave);
})(typeof self !== 'undefined' ? self : this, function (FITS, S3CUT, WAVE0) {
  'use strict';
  // looked up when used, so the order of the <script> tags does not matter (wave.js may load after this file)
  const W_ = () => WAVE0 || (typeof self !== 'undefined' && self.SkyWave);
  const BLOCK = 2880, FR = 2;   // FR: flag rows read on each side of the star
  const riceDecode = (...a) => S3CUT.riceDecode(...a);   // in s3cut.js (shared with the field cutouts)
  const ascii = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  function readCards(u8) {
    const cards = [];
    for (let p = 0; p + 80 <= u8.length; p += 80) { const c = ascii(u8.subarray(p, p + 80)); cards.push(c); if (/^END\s*$/.test(c)) return { cards, size: Math.ceil((p + 80) / BLOCK) * BLOCK }; }
    return null;
  }
  function headerOf(cards) {   // same parsing as the field cutouts (the app's own FITS reader)
    const fixed = cards.map(c => /^NAXIS\s*=/.test(c) ? 'NAXIS   =                    0'.padEnd(80) : /^(SIMPLE|XTENSION)/.test(c) ? 'SIMPLE  =                    T'.padEnd(80) : c);
    const n = Math.ceil(fixed.length * 80 / BLOCK) * BLOCK, u8 = new Uint8Array(n).fill(32), txt = fixed.join('');
    for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i);
    const h = FITS.parseFITS(u8.buffer)[0].header;
    for (const c of cards) { const m = /^(NAXIS\d?|XTENSION|PCOUNT|THEAP)\s*=\s*('?)([^'/]*)/.exec(c); if (m) h[m[1]] = m[2] ? m[3].trim() : +m[3]; }
    return h;
  }

  // data release + detector, e.g. "qr3:6" or "dr1:4" (v0.57.1: any release folder, not just QR ones; files of one release and detector share their header layout)
  const keyOf = url => { const r = /\/([a-z]{1,4}\d+)\/level\d/i.exec(url), d = /D(\d)_spx/i.exec(url); return (r ? r[1].toLowerCase() : '?') + ':' + (d ? d[1] : '?'); };

  // First file of a release + detector: the full header walk, plus the wavelength table.
  async function learn(get, url) {
    const { hdus } = await S3CUT.layout(get, null);
    const by = n => hdus.find(x => x.name === n), hi = by('IMAGE'), hf = by('FLAGS'), hw = by('WCS-WAVE');
    if (!hi) throw new Error('No IMAGE extension');
    let table = null;
    if (hw) {
      const data = hw.tail || (await get(hw.dataOff, hw.dataOff + hw.dataLen - 1)).buf;
      const ab = data.slice(0, hw.dataLen).buffer;
      try { table = W_().readWaveTable(ab, [{ header: Object.assign({}, hw.header, { EXTNAME: 'WCS-WAVE', XTENSION: 'BINTABLE' }), dataStart: 0 }]); } catch { table = null; }
    }
    return { img: { off: hi.off, hsize: hi.dataOff - hi.off }, flg: hf ? { off: hf.off, hsize: hf.dataOff - hf.off, header: hf.header } : null, table, url };
  }

  /** Pixels within R of (ra, dec) (bad-pixel flags only within FR rows of the star) on one file. memo: object shared by all calls (learned layouts per release + detector).
      Returns { data: Float32Array(w*h), bad: Uint8Array|null, w, h, cx, cy (0-based star position in the box), lam, bw,
      header, requests, bytes } or throws (status 404 when the star is not on the file). */
  async function spot(get0, url, ra, dec, R, memo, badMask, flagRows = FR) {
    let requests = 0, bytes = 0;
    const get = async (a, b) => { const r = await get0(a, b); requests++; bytes += r.buf.length; return r; };
    const key = keyOf(url);
    let L = memo[key], fresh = false;
    if (!L) { L = memo[key] = learn(get, url); fresh = true; }
    try { L = await L; } catch (e) { delete memo[key]; throw e; }
    const readHdr = async (o) => { const r = await get(o.off, o.off + o.hsize - 1); const c = readCards(r.buf); return c && c.size === o.hsize ? headerOf(c.cards) : null; };
    // Only the IMAGE header is read for every file (its WCS says where the star is). The FLAGS header is taken from the first
    // file of this release + detector: same layout, and the flag rows are read at the same place (saves 14 kB per image).
    let hI = await readHdr(L.img);
    if (!hI || hI.NAXIS1 == null) {   // layout differs: learn again from this file
      if (fresh) throw new Error('Unexpected FITS layout');
      L = memo[key] = await learn(get, url); hI = await readHdr(L.img);
      if (!hI) throw new Error('Unexpected FITS layout');
    }
    const hF = L.flg ? L.flg.header : null;
    const nx = hI.NAXIS1, ny = hI.NAXIS2, p = FITS.sky2pix(FITS.makeWCS(hI), ra, dec);
    if (!p || !(p[0] > 0.5 && p[1] > 0.5 && p[0] < nx + 0.5 && p[1] < ny + 0.5)) { const e = new Error('The star is not on this image'); e.status = 404; throw e; }
    const x0 = Math.max(0, Math.round(p[0] - 1) - R), x1 = Math.min(nx - 1, Math.round(p[0] - 1) + R);
    const y0 = Math.max(0, Math.round(p[1] - 1) - R), y1 = Math.min(ny - 1, Math.round(p[1] - 1) + R), w = x1 - x0 + 1, h = y1 - y0 + 1;
    const dI = L.img.off + L.img.hsize, bpI = Math.abs(hI.BITPIX) / 8;
    if (hI.BITPIX !== -32) throw new Error('IMAGE BITPIX ' + hI.BITPIX);
    const jobs = [get(dI + y0 * nx * bpI, dI + (y1 + 1) * nx * bpI - 1)];
    // FLAGS only for the rows of the aperture (the sky ring uses a median, which a few bad pixels do not move): less to download
    const cyI = Math.round(p[1] - 1), fy0 = Math.max(y0, cyI - flagRows), fy1 = Math.min(y1, cyI + flagRows), fh = fy1 - fy0 + 1;
    let fl = null;
    if (hF) {
      const dF = L.flg.off + L.flg.hsize;
      if (!hF.ZIMAGE && hF.BITPIX === 32 && hF.NAXIS1 === nx) jobs.push(get(dF + fy0 * nx * 4, dF + (fy1 + 1) * nx * 4 - 1).then(r => ({ plain: r.buf })));
      else if (hF.ZIMAGE && /RICE/.test(hF.ZCMPTYPE || '') && hF.ZTILE2 === 1 && hF.ZTILE1 === nx && hF.ZBITPIX === 32 && hF.NAXIS1 === 8) {
        jobs.push((async () => {
          const ix = (await get(dF + fy0 * 8, dF + (fy1 + 1) * 8 - 1)).buf, dv = new DataView(ix.buffer, ix.byteOffset, ix.byteLength), rows = [];
          for (let j = 0; j < fh; j++) rows.push({ n: dv.getInt32(j * 8, false), o: dv.getInt32(j * 8 + 4, false) });
          const heap = dF + (hF.THEAP || hF.NAXIS1 * hF.NAXIS2), lo = Math.min(...rows.map(r => r.o)), hi = Math.max(...rows.map(r => r.o + r.n));
          const hb = (await get(heap + lo, heap + hi - 1)).buf;
          return { rice: rows.map(r => riceDecode(hb.subarray(r.o - lo, r.o - lo + r.n), nx, hF.ZVAL1 || 32, hF.ZVAL2 || 4)) };
        })().catch(() => null));   // flags unreadable: measured without them (reported)
      }
    }
    const [rI, rF] = await Promise.all(jobs);
    const bufI = rI.buf; if (bufI.length !== h * nx * bpI) throw new Error('Short read');
    const dvI = new DataView(bufI.buffer, bufI.byteOffset, bufI.byteLength), data = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = dvI.getFloat32((j * nx + x0 + i) * 4, false);
    let bad = null, flags = null;
    if (rF) {
      bad = new Uint8Array(w * h); flags = new Uint32Array(w * h); const m = badMask >>> 0;
      const o = fy0 - y0, dv = rF.plain && rF.plain.length === fh * nx * 4 ? new DataView(rF.plain.buffer, rF.plain.byteOffset, rF.plain.byteLength) : null;
      if (dv || rF.rice) for (let j = 0; j < fh; j++) for (let i = 0; i < w; i++) {
        const v = dv ? dv.getUint32((j * nx + x0 + i) * 4, false) : rF.rice[j][x0 + i] >>> 0, k = (j + o) * w + i;
        flags[k] = v; bad[k] = ((v & m) >>> 0) ? 1 : 0;
      }
      else { bad = null; flags = null; }
    }
    const wv = L.table ? W_().waveAtPixel(L.table, hI, p[0], p[1]) : null;
    return { data, bad, flags, w, h, cx: p[0] - 1 - x0, cy: p[1] - 1 - y0, lam: wv ? wv.lam : null, bw: wv ? wv.bw : null, header: hI, flagHeader: hF, requests, bytes, key };
  }

  /** Aperture photometry on a spot: sum within rAp px minus the median sky in rIn..rOut, in mJy (image unit MJy/sr).
      Returns ok:false when a pixel inside the aperture is flagged bad (bits: its flag bits) or missing. err: from the sky scatter. */
  // core > 0: "wing" photometry for saturated stars (Phase 5): only the ring core < r <= rAp is summed, so a blanked or
  // overflowing centre is left out. Its flux is a fixed fraction of the star's only if the PSF stays the same, so it is used
  // for brightness CHANGES, with comparison stars measured the same way. Needs flag rows out to rAp (spot(..., flagRows)).
  function photometry(s, rAp = 2.5, rIn = 4, rOut = 7, pixArcsec = 6.15, core = 0) {
    let sum = 0, np = 0, badIn = 0, bits = 0; const sky = [];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const r = Math.hypot(i - s.cx, j - s.cy), k = j * s.w + i, v = s.data[k], b = (s.bad && s.bad[k]) || !Number.isFinite(v);
      if (r <= core) continue;
      if (r <= rAp) { if (b) { badIn++; if (s.bad && s.bad[k]) bits = (bits | s.flags[k]) >>> 0; } else { sum += v; np++; } }
      else if (r >= rIn && r <= rOut && !b) sky.push(v);
    }
    if (badIn || np < (core ? 20 : 9) || sky.length < 30) return { ok: false, badIn, bits, np, nsky: sky.length };
    sky.sort((a, b) => a - b);
    const med = sky[sky.length >> 1], dev = sky.map(v => Math.abs(v - med)).sort((a, b) => a - b), sig = 1.4826 * dev[dev.length >> 1];
    const k = 1e9 * (pixArcsec / 206264.806) ** 2;   // MJy/sr * pixel solid angle -> mJy
    const peak = Math.max(...Array.from(s.data).filter(Number.isFinite));
    return { ok: true, mJy: (sum - np * med) * k, err: sig * Math.sqrt(np + np * np / sky.length) * k, sky: med, np, peak };
  }

  return { spot, photometry, riceDecode, keyOf };
});
