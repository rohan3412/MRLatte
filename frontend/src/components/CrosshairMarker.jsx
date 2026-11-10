import React from "react";
import { getCrosshairValue, markerFraction, subscribeCrosshairValues } from "@/lib/crosshairValues";

/**
 * A thin vertical line over a threshold or colour-range slider at the voxel
 * value under the crosshair for `layerKey`. Put it inside a `relative` box
 * spanning the slider; `inset` is the px the slider's scale is inset from each
 * side of that box. It moves its own element, at most once per animation frame,
 * and only while it is on screen (IntersectionObserver: a closed card, a hidden
 * inspector or a scrolled-away block does no work); coming back into view it
 * catches up at once. Hidden when the crosshair is outside the layer.
 */
export function CrosshairMarker({ layerKey, min, max, inset = 0 }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return undefined;
    let visible = typeof IntersectionObserver === "undefined";
    let raf = 0;
    const apply = () => {
      raf = 0;
      const f = markerFraction(getCrosshairValue(layerKey), min, max);
      if (f === null) { el.style.display = "none"; return; }
      el.style.display = "block";
      el.style.left = `calc(${inset}px + (100% - ${inset * 2}px) * ${f})`;
    };
    const schedule = () => { if (visible && !raf) raf = requestAnimationFrame(apply); };
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) schedule();
    });
    io?.observe(box);
    const off = subscribeCrosshairValues(schedule);
    schedule();
    return () => {
      off();
      io?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [layerKey, min, max, inset]);
  return (
    <div ref={ref} aria-hidden="true" data-testid="crosshair-marker"
      className="pointer-events-none absolute inset-y-0 z-[1] hidden w-px bg-foreground/70" />
  );
}

export default CrosshairMarker;
