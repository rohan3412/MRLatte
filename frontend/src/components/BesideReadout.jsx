import React, { useEffect, useRef, useState } from "react";
import { tilesAt } from "@/lib/viewer/effects";
import { CrosshairInfo } from "@/components/CrosshairInfo";

// The readout "beside the crosshair" (Preferences ▸ Viewer ▸ Readout): a small
// tag offset from the crosshair on the active 2D tile. It fades while the view
// is being scrolled or dragged, so it never sits between you and what you are
// moving, and returns a moment after you stop. `wrapperRef` is the viewer's
// positioned wrapper (the canvas lives in it).
const OFFSET = 14;
const FADE_BACK_MS = 350;

export const BesideReadout = ({ wrapperRef, viewerRef, activeOrientation, mm, vox, values, labels }) => {
  const [at, setAt] = useState(null);
  const [faded, setFaded] = useState(false);
  const tagRef = useRef(null);
  const timer = useRef(null);

  // Where the crosshair is on the active tile, whenever it (or the view) moves.
  useEffect(() => {
    const nv = viewerRef.current?.getNiivue?.();
    const wrap = wrapperRef.current;
    const canvas = wrap?.querySelector("canvas");
    if (!nv || !mm || !canvas) { setAt(null); return; }
    const tiles = tilesAt(nv, mm);
    const tile = tiles.find((t) => t.orient === activeOrientation) || tiles[0];
    if (!tile) { setAt(null); return; }
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const [rl, rt, rw, rh] = tile.rect || [0, 0, canvas.clientWidth, canvas.clientHeight];
    setAt({ x: ox + tile.x, y: oy + tile.y, box: { l: ox + rl, t: oy + rt, r: ox + rl + rw, b: oy + rt + rh } });
  }, [mm, activeOrientation, viewerRef, wrapperRef]);

  // Fade while scrolling or dragging in the viewer.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return undefined;
    const fade = () => { setFaded(true); clearTimeout(timer.current); timer.current = setTimeout(() => setFaded(false), FADE_BACK_MS); };
    const down = () => { setFaded(true); clearTimeout(timer.current); };
    const up = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setFaded(false), FADE_BACK_MS); };
    wrap.addEventListener("wheel", fade, { passive: true });
    wrap.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up);
    return () => {
      wrap.removeEventListener("wheel", fade);
      wrap.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up);
      clearTimeout(timer.current);
    };
  }, [wrapperRef]);

  if (!at) return null;
  // Keep the tag inside its own tile, not just the viewer (it used to spill
  // into the neighbouring view): flip to the crosshair's other side near an
  // edge, and if the tile is too small for it either way, pin it to the
  // tile's top-left corner.
  const w = tagRef.current?.offsetWidth || 260;
  const h = tagRef.current?.offsetHeight || 80;
  const { box } = at;
  const place = (p, lo, hi, size) => {
    if (p + OFFSET + size <= hi - 4) return p + OFFSET;
    if (p - OFFSET - size >= lo + 4) return p - OFFSET - size;
    return lo + 4;
  };
  const left = place(at.x, box.l, box.r, w);
  const top = place(at.y, box.t, box.b, h);
  return (
    <div ref={tagRef} className="ro-tag frosted pointer-events-none absolute z-20 rounded-[8px]"
      style={{ left, top, maxWidth: Math.max(60, box.r - box.l - 8), overflow: "hidden" }} data-faded={faded ? "" : undefined} data-testid="readout-tag">
      <CrosshairInfo bare mm={mm} vox={vox} values={values} labels={labels} />
    </div>
  );
};

export default BesideReadout;
