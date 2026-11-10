// The arithmetic behind slider snapping and the readouts' up/down steppers
// (owner, 5 Nov: sliders snap to meaningful values, and because snapping makes
// a value just next to a snap point hard to reach, every readout can be typed
// into and stepped).

/** A step of 1, 2 or 5 times a power of ten, near a hundredth of the range;
 *  never below 1 for whole-number sliders. */
export function niceStep(min, max, integer = false) {
  const raw = Math.abs(max - min) / 100 || 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.999);
  const rounded = Number(step.toPrecision(6));
  return integer ? Math.max(1, Math.round(rounded)) : rounded;
}

/** `value`, or the snap point it is within `within` (a fraction of the range,
 *  2 % by default) of. `bypass` (Alt held) never snaps. */
export function snapValue(value, snaps, min, max, { within = 0.02, bypass = false } = {}) {
  if (bypass || !snaps?.length) return { value, snapped: false };
  const reach = Math.abs(max - min) * within;
  let best = null;
  for (const s of snaps) {
    if (Math.abs(value - s) <= reach && (best === null || Math.abs(value - s) < Math.abs(value - best))) best = s;
  }
  return best === null ? { value, snapped: false } : { value: best, snapped: true };
}
