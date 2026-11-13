/* ARCNAVE v0.14: prepares one SPHEREx cutout (bad pixels, ZODI, reprojection, background) off the main thread, so the page
   never freezes while the agents load images. Same code as the main thread and the tests (lib/fits.js prepareCutout).
   v0.52: also builds the Changes view (lib/fits.js changeMaps, ~2 s on a 24-image field), so the report shows without a
   freeze. Same function, same numbers as on the main thread. */
importScripts('/lib/fits.js');
onmessage = e => {
  const { id, kind } = e.data;
  try {
    if (kind === 'epsf') {   // v0.57.8: one image's star shape (lib/fits.js epsfGrid, 0.2-0.4 s), sent back without its at()
      const { flat, n, st, opts } = e.data, P = SkyFits.epsfGrid(flat, n, st, opts);
      if (P) delete P.at;
      postMessage({ id, out: P });
      return;
    }
    if (kind === 'chg') {
      const { stacks, frames, n, opts } = e.data, r = SkyFits.changeMaps(stacks, frames, n, opts);
      postMessage({ id, out: r }, [r.epochRGBA.buffer, r.timeRGBA.buffer]);
      return;
    }
    const { buf, grid } = e.data;
    const pc = SkyFits.prepareCutout(buf, grid);
    const t = [pc.flat, pc.flatKeep, pc.touched, pc.touchedHard].filter(Boolean).map(a => a.buffer);
    postMessage({ id, out: pc }, t);
  } catch (err) { postMessage({ id, error: err.message || String(err) }); }
};
