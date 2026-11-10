/* ARCNAVE v0.17: SPHEREx cutouts straight from NASA's open-data copy on AWS S3, by HTTP range reads.
   Why: the IRSA cutout service takes about 25-45 s per image whatever the size (measured live: 0.5 deg 32 s, 0.1 deg 26 s,
   i.e. waiting, not bandwidth). IRSA also publishes the same files in the public bucket s3://nasa-irsa-spherex (AWS Open
   Data, same path as /ibe/data/spherex/...). A full file is ~72 MB, but FITS images are stored row by row, so the rows that
   hold the field are one contiguous byte range per extension. Reading just those rows of IMAGE, FLAGS and ZODI (plus the
   headers and the small WCS-WAVE table) gives the same cutout in a few seconds.
   Output: a FITS file with the extensions ARCNAVE keeps (PRIMARY, IMAGE, FLAGS, ZODI, WCS-WAVE), headers exactly as in the
   original file except NAXIS1/2 and the reference pixels (CRPIX1/2, CRPIX1A/2A, CRPIX1W/2W) moved by the cutout offset, which
   is what the IRSA cutout service does too (checked on real cutouts). The box is every pixel within size/2 of the centre.
   Works in Node and in the browser. get(start, end) must return a Promise of { buf: Uint8Array, total: number|null }. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fits'));
  else root.S3Cut = factory(root.SkyFits);
})(typeof self !== 'undefined' ? self : this, function (FITS) {
  'use strict';
  const BLOCK = 2880, WINDOW = 65536;
  const KEEP = ['IMAGE', 'FLAGS', 'ZODI'];
  const S3_BASE = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/';
  const IBE = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/';

  /** IRSA file URL -> the same file in the public S3 bucket (null for anything else). */
  function s3Url(irsaUrl) {
    const u = String(irsaUrl).split('?')[0];
    if (!u.startsWith(IBE)) return null;
    const rest = u.slice(IBE.length);
    if (!/^[A-Za-z0-9_./-]+\.fits$/.test(rest) || rest.includes('..')) return null;
    return S3_BASE + rest;
  }

  const ascii = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };

  /** Header cards starting at byte `at` of u8. Returns null if END is not inside u8. */
  function readCards(u8, at) {
    const cards = [];
    for (let p = at; p + 80 <= u8.length; p += 80) {
      const c = ascii(u8.subarray(p, p + 80));
      cards.push(c);
      if (/^END\s*$/.test(c)) return { cards, size: Math.ceil((p + 80 - at) / BLOCK) * BLOCK };
    }
    return null;
  }
  // parse with the app's own FITS reader (so values are read exactly as the analysis will read them)
  function parseCardsOnly(cards) {
    // tiny buffer: header + END, NAXIS forced to 0 so parseFITS does not look for data
    const fixed = cards.map(c => /^NAXIS\s*=/.test(c) ? 'NAXIS   =                    0'.padEnd(80) : /^(SIMPLE|XTENSION)/.test(c) ? 'SIMPLE  =                    T'.padEnd(80) : c);
    const n = Math.ceil(fixed.length * 80 / BLOCK) * BLOCK, u8 = new Uint8Array(n).fill(32), txt = fixed.join('');
    for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i);
    const h = FITS.parseFITS(u8.buffer)[0].header;
    // the real NAXIS / XTENSION back
    for (const c of cards) { const m = /^(NAXIS|XTENSION)\s*=\s*('?)([^'/]*)/.exec(c); if (m) h[m[1]] = m[2] ? m[3].trim() : +m[3]; }
    return h;
  }
  function dataBytes(h) {
    const naxis = h.NAXIS || 0; let prod = naxis ? 1 : 0;
    for (let i = 1; i <= naxis; i++) prod *= h['NAXIS' + i] || 0;
    return (Math.abs(h.BITPIX || 8) / 8) * (h.GCOUNT || 1) * ((h.PCOUNT || 0) + prod);
  }
  const pad = n => Math.ceil(n / BLOCK) * BLOCK;

  /** Walk the HDUs by reading only their headers. Returns [{name, header, cards, off, dataOff, dataLen, tail}].
      hint: header offsets of an earlier file of the same kind. Files of one pipeline version share their layout, so those
      headers are asked for at once, in parallel with the first window; if the guess is wrong the walk just asks again. */
  async function layout(get, hint) {
    const ahead = new Map();
    // v0.38: an offset beyond the end of THIS file gets HTTP 416, which browsers print as a red console error (harmless, but it
    // looks broken). So only offsets below the smallest file of this kind seen so far go out at once; the rest wait for the
    // first answer, which gives this file's size.
    // The last header (the small WCS-WAVE table at the very end) always waits: it is the one a smaller file does not reach
    // (measured: 2 such 416s per new field were left with the size check alone).
    const safe = hint && hint.minTotal ? hint.minTotal : 0, last = hint && hint.length ? Math.max(...hint) : -1;
    for (const o of hint || []) if (o > 0 && o < safe && o !== last) ahead.set(o, get(o, o + WINDOW - 1).catch(() => null));
    const first = await get(0, WINDOW - 1), total = first.total;
    for (const o of hint || []) if (o > 0 && !ahead.has(o) && (total == null || o < total)) ahead.set(o, get(o, o + WINDOW - 1).catch(() => null));
    const hdus = []; let off = 0, win = first.buf, winAt = 0;
    while (true) {
      if (total != null && off >= total) break;
      let r = off >= winAt && off - winAt < win.length ? readCards(win, off - winAt) : null;
      if (!r && ahead.has(off)) { const g = await ahead.get(off); if (g && g.buf.length) { win = g.buf; winAt = off; r = readCards(win, 0); } }
      if (!r) {
        const g = await get(off, off + WINDOW - 1); win = g.buf; winAt = off;
        if (!win.length) break;
        r = readCards(win, 0);
        if (!r) { const g2 = await get(off, off + 4 * WINDOW - 1); win = g2.buf; winAt = off; r = readCards(win, 0); }
        if (!r) throw new Error('S3 cutout: FITS header too long or truncated at byte ' + off);
      }
      const header = parseCardsOnly(r.cards), name = String(header.EXTNAME || (hdus.length ? '' : 'PRIMARY')).toUpperCase();
      const dataOff = off + r.size, dataLen = dataBytes(header);
      const hdu = { name, header, cards: r.cards, off, dataOff, dataLen };
      // small tables at the end come with the window (WCS-WAVE: ~3 kB)
      if (dataOff + dataLen <= winAt + win.length) hdu.tail = win.subarray(dataOff - winAt, dataOff - winAt + dataLen);
      hdus.push(hdu);
      off = dataOff + pad(dataLen);
      if (name === 'WCS-WAVE' || hdus.length > 12) break;
    }
    return { hdus, total };
  }

  function setCard(cards, key, value) {
    const k = key.padEnd(8), i = cards.findIndex(c => c.startsWith(k + '='));
    if (i < 0) return false;
    const old = cards[i], slash = old.indexOf(' /', 10), comment = slash >= 0 ? old.slice(slash) : '';
    const v = Number.isInteger(value) ? String(value) : String(+value.toPrecision(15));
    cards[i] = (k + '= ' + v.padStart(20) + comment).slice(0, 80).padEnd(80);
    return true;
  }
  function headerBytes(cards) {
    const n = pad(cards.length * 80), u8 = new Uint8Array(n).fill(32), txt = cards.join('');
    for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i);
    return u8;
  }

  /** The cutout box (1-based, inclusive) for a field of `size` deg around ra, dec on this image, or null if off the image. */
  function box(h, ra, dec, size) {
    const wcs = FITS.makeWCS(h), p = FITS.sky2pix(wcs, ra, dec);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const cd11 = h.CD1_1 ?? (h.CDELT1 || 0) * (h.PC1_1 ?? 1), cd12 = h.CD1_2 ?? (h.CDELT1 || 0) * (h.PC1_2 ?? 0);
    const cd21 = h.CD2_1 ?? (h.CDELT2 || 0) * (h.PC2_1 ?? 0), cd22 = h.CD2_2 ?? (h.CDELT2 || 0) * (h.PC2_2 ?? 1);
    let scale = Math.sqrt(Math.abs(cd11 * cd22 - cd12 * cd21)) * 3600;
    if (!(scale > 0.5 && scale < 60)) scale = 6.15;
    const r = size * 3600 / 2 / scale, nx = h.NAXIS1, ny = h.NAXIS2;
    const n = Math.max(1, Math.round(2 * r));   // 293 pixels for 0.5 deg, as IRSA's cutouts
    const x1 = Math.max(1, Math.round(p[0] - r)), x2 = Math.min(nx, Math.round(p[0] - r) + n - 1);
    const y1 = Math.max(1, Math.round(p[1] - r)), y2 = Math.min(ny, Math.round(p[1] - r) + n - 1);
    if (x2 < x1 || y2 < y1) return null;
    return { x1, x2, y1, y2 };
  }

  /** Rice decompression (cfitsio fits_rdecomp, 32-bit pixels, FSBITS 5, FSMAX 25). Returns Int32Array(n). */
  function riceDecode(c, n, nblock = 32, bytepix = 4) {
    if (bytepix !== 4) throw new Error('RICE: only 4-byte pixels');
    const out = new Int32Array(n), FSBITS = 5, FSMAX = 25, BBITS = 32;
    let p = 0;
    const byte = () => { if (p >= c.length) throw new Error('RICE: ran out of data'); return c[p++]; };
    let last = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) | 0; p = 4;
    let b = byte(), nbits = 8;
    for (let i = 0; i < n;) {
      nbits -= FSBITS;
      while (nbits < 0) { b = ((b << 8) | byte()) >>> 0; nbits += 8; }
      const fs = (b >>> nbits) - 1; b &= (1 << nbits) - 1;
      const imax = Math.min(i + nblock, n);
      if (fs < 0) { for (; i < imax; i++) out[i] = last; }
      else if (fs === FSMAX) {
        for (; i < imax; i++) {
          let k = BBITS - nbits, diff = (b * 2 ** k) >>> 0;
          for (k -= 8; k >= 0; k -= 8) { b = byte(); diff = (diff | (b * 2 ** k)) >>> 0; }
          if (nbits > 0) { b = byte(); diff = (diff | (b >>> (-k))) >>> 0; b &= (1 << nbits) - 1; } else b = 0;
          const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
          last = (last + d) | 0; out[i] = last;
        }
      } else {
        for (; i < imax; i++) {
          while (b === 0) { nbits += 8; b = byte(); }
          let nzero = nbits - (31 - Math.clz32(b)) - 1;   // leading zeros inside the nbits that are left
          nbits -= nzero + 1; b ^= 1 << nbits;
          nbits -= fs;
          while (nbits < 0) { b = ((b << 8) | byte()) >>> 0; nbits += 8; }
          const diff = ((nzero << fs) | (b >>> nbits)) >>> 0; b &= (1 << nbits) - 1;
          const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
          last = (last + d) | 0; out[i] = last;
        }
      }
    }
    return out;
  }

  // v0.35: QR3 files store FLAGS tile-compressed (RICE_1, one tile per image row, 32-bit). Same rows, read through the
  // row index (8 bytes per row: compressed size, offset in the heap) and decoded here.
  const isRiceRows = h => !!h.ZIMAGE && /RICE/.test(String(h.ZCMPTYPE || '')) && h.ZTILE2 === 1 && h.ZTILE1 === h.ZNAXIS1 && h.ZBITPIX === 32 && h.NAXIS1 === 8;
  async function riceRows(get, x, y0, hgt) {
    const ix = (await get(x.dataOff + y0 * 8, x.dataOff + (y0 + hgt) * 8 - 1)).buf;
    if (ix.length !== hgt * 8) throw new Error('S3 cutout: short read for ' + x.name + ' row index');
    const dv = new DataView(ix.buffer, ix.byteOffset, ix.byteLength), rows = [];
    for (let j = 0; j < hgt; j++) rows.push({ n: dv.getInt32(j * 8, false), o: dv.getInt32(j * 8 + 4, false) });
    const heap = x.dataOff + (x.header.THEAP || x.header.NAXIS1 * x.header.NAXIS2), lo = Math.min(...rows.map(r => r.o)), hi = Math.max(...rows.map(r => r.o + r.n));
    const hb = (await get(heap + lo, heap + hi - 1)).buf;
    if (hb.length !== hi - lo) throw new Error('S3 cutout: short read for ' + x.name + ' rows');
    return rows.map(r => riceDecode(hb.subarray(r.o - lo, r.o - lo + r.n), x.header.ZNAXIS1, x.header.ZVAL1 || 32, x.header.ZVAL2 || 4));
  }
  // The header of a decompressed RICE image: an ordinary 32-bit IMAGE extension with the same keywords (WCS, flag names)
  function plainCards(cards, w, hgt) {
    const drop = /^(TFIELDS|TTYPE\d|TFORM\d|TUNIT\d|ZIMAGE|ZTENSION|ZBITPIX|ZNAXIS\d?|ZPCOUNT|ZGCOUNT|ZTILE\d|ZCMPTYPE|ZNAME\d|ZVAL\d|ZQUANTIZ|ZDITHER0|ZSIMPLE|ZEXTEND|ZBLOCKED|ZHECKSUM|ZDATASUM|THEAP|CHECKSUM|DATASUM)\s*=/;
    const out = [];
    for (const c of cards) {
      if (drop.test(c)) continue;
      if (/^XTENSION=/.test(c)) out.push("XTENSION= 'IMAGE   '           / image extension".padEnd(80));
      else if (/^BITPIX  =/.test(c)) out.push('BITPIX  =                   32 / array data type'.padEnd(80));
      else if (/^NAXIS1  =/.test(c)) out.push(('NAXIS1  = ' + String(w).padStart(20)).padEnd(80));
      else if (/^NAXIS2  =/.test(c)) out.push(('NAXIS2  = ' + String(hgt).padStart(20)).padEnd(80));
      else if (/^PCOUNT  =/.test(c)) out.push('PCOUNT  =                    0'.padEnd(80));
      else out.push(c);
    }
    return out;
  }

  /** Cut one SPHEREx file. Returns { fits: Uint8Array, box, bytesRead, requests }. */
  async function cutout(get, ra, dec, size, hint) {
    let bytesRead = 0, requests = 0;
    const counted = async (a, b) => { const r = await get(a, b); bytesRead += r.buf.length; requests++; return r; };
    const { hdus, total } = await layout(counted, hint);
    const by = n => hdus.find(x => x.name === n);
    const hi = by('IMAGE'), hw = by('WCS-WAVE');
    if (!hi || !hdus[0]) throw new Error('S3 cutout: no IMAGE extension');
    for (const n of KEEP) { const x = by(n); if (!x) continue; const rc = isRiceRows(x.header), X = rc ? x.header.ZNAXIS1 : x.header.NAXIS1, Y = rc ? x.header.ZNAXIS2 : x.header.NAXIS2;
      if (X !== hi.header.NAXIS1 || Y !== hi.header.NAXIS2) throw new Error('S3 cutout: ' + n + ' size differs from IMAGE'); }
    const b = box(hi.header, ra, dec, size);
    if (!b) { const e = new Error('The field is not on this image'); e.status = 404; throw e; }
    const nx = hi.header.NAXIS1, w = b.x2 - b.x1 + 1, hgt = b.y2 - b.y1 + 1, x0 = b.x1 - 1, y0 = b.y1 - 1;
    const parts = [headerBytes(hdus[0].cards)];
    const keep = KEEP.map(by).filter(Boolean);
    const rows = await Promise.all(keep.map(x => {
      if (isRiceRows(x.header)) return riceRows(counted, x, y0, hgt).then(rr => ({ rice: rr }));
      const bpp = Math.abs(x.header.BITPIX) / 8;
      if (x.header.NAXIS !== 2 || ![8, 16, 32, -32, -64].includes(x.header.BITPIX)) throw new Error('S3 cutout: unexpected ' + x.name + ' layout');
      return counted(x.dataOff + y0 * nx * bpp, x.dataOff + (y0 + hgt) * nx * bpp - 1);
    }));
    keep.forEach((x, k) => {
      if (rows[k].rice) {   // decoded rows -> a plain 32-bit image of the box, big-endian like FITS
        const out = new Uint8Array(pad(w * hgt * 4)), dv = new DataView(out.buffer);
        for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) dv.setInt32((j * w + i) * 4, rows[k].rice[j][x0 + i], false);
        const cards = plainCards(x.cards, w, hgt);
        for (const [key, d] of [['CRPIX1', x0], ['CRPIX2', y0], ['CRPIX1A', x0], ['CRPIX2A', y0], ['CRPIX1W', x0], ['CRPIX2W', y0]]) { const v = x.header[key]; if (typeof v === 'number') setCard(cards, key, v - d); }
        cards.splice(cards.length - 1, 0, ('HISTORY ARCNAVE cutout: RICE_1 rows ' + b.y1 + '-' + b.y2 + ' decoded, columns ' + b.x1 + '-' + b.x2 + ' (S3)').slice(0, 80).padEnd(80));
        parts.push(headerBytes(cards), out); return;
      }
      const bpp = Math.abs(x.header.BITPIX) / 8, src = rows[k].buf;
      if (src.length !== hgt * nx * bpp) throw new Error('S3 cutout: short read for ' + x.name);
      const out = new Uint8Array(pad(w * hgt * bpp));
      for (let j = 0; j < hgt; j++) out.set(src.subarray((j * nx + x0) * bpp, (j * nx + x0 + w) * bpp), j * w * bpp);
      const cards = x.cards.slice();
      setCard(cards, 'NAXIS1', w); setCard(cards, 'NAXIS2', hgt);
      for (const [key, d] of [['CRPIX1', x0], ['CRPIX2', y0], ['CRPIX1A', x0], ['CRPIX2A', y0], ['CRPIX1W', x0], ['CRPIX2W', y0]]) {
        const v = x.header[key]; if (typeof v === 'number') setCard(cards, key, v - d);
      }
      cards.splice(cards.length - 1, 0, ('HISTORY ARCNAVE cutout: rows ' + b.y1 + '-' + b.y2 + ', columns ' + b.x1 + '-' + b.x2 + ' of the full image (S3)').slice(0, 80).padEnd(80));
      parts.push(headerBytes(cards), out);
    });
    if (hw) {
      let data = hw.tail;
      if (!data) data = (await counted(hw.dataOff, hw.dataOff + hw.dataLen - 1)).buf;
      const tbl = new Uint8Array(pad(hw.dataLen)); tbl.set(data.subarray(0, hw.dataLen));
      parts.push(headerBytes(hw.cards), tbl);
    }
    const n = parts.reduce((s, p) => s + p.length, 0), fits = new Uint8Array(n); let at = 0;
    for (const p of parts) { fits.set(p, at); at += p.length; }
    const offsets = hdus.map(x => x.off); offsets.minTotal = Math.min(total || Infinity, (hint && hint.minTotal) || Infinity); if (!isFinite(offsets.minTotal)) offsets.minTotal = 0;
    return { fits, box: b, bytesRead, requests, offsets };
  }

  return { s3Url, cutout, box, layout, riceDecode };
});
