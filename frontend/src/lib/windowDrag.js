// Right-drag windowing of the base volume (toolbar: Right-drag → Window).
// Drag up/down moves the level (centre), left/right narrows/widens the width;
// the same directions NiiVue's own windowing used. NiiVue moved both ends by
// one raw unit per mouse event, whatever the scan's range: far too coarse for
// a 0–1 float map and far too slow for CT's −1024…3000. Here the speed scales
// with the data's range, so every scan feels the same:
//   level: dragging LEVEL_PX_PER_RANGE pixels sweeps the whole range;
//   width: multiplicative, ×e per WIDTH_PX_PER_E pixels, so a narrow window
//          is as easy to fine-tune as a wide one.
// Shift divides both speeds by FINE_DIVISOR. Everything is measured from where
// the drag started, so a drag back to the start restores the window exactly.
import { RIGHT_CLICK_SLOP_PX } from "@/lib/rightClickGate";

export const LEVEL_PX_PER_RANGE = 400;
export const WIDTH_PX_PER_E = 150;
export const FINE_DIVISOR = 5;

export function windowFromDrag({ startLo, startHi, gmin, gmax, dx, dy, fine = false }) {
  const range = gmax > gmin ? gmax - gmin : 1;
  const k = fine ? 1 / FINE_DIVISOR : 1;
  const startLevel = (startLo + startHi) / 2;
  const startWidth = Math.max(startHi - startLo, range / 1000);
  const level = clamp(startLevel - (dy * k * range) / LEVEL_PX_PER_RANGE, gmin, gmax);
  const width = clamp(startWidth * Math.exp((dx * k) / WIDTH_PX_PER_E), range / 1000, range);
  return windowFromLevelWidth({ level, width, gmin, gmax });
}

// The window for a given level (centre) and width, kept inside the data range:
// width at most the range, and at an edge the window keeps its width and
// slides in, so it never collapses. Shared by the drag and the base card's
// Level / Width sliders so both land on exactly the same window.
export function windowFromLevelWidth({ level, width, gmin, gmax }) {
  const range = gmax > gmin ? gmax - gmin : 1;
  const w = clamp(width, range / 1000, range);
  const c = clamp(level, gmin, gmax);
  let lo = c - w / 2;
  let hi = c + w / 2;
  if (lo < gmin) { hi += gmin - lo; lo = gmin; }
  if (hi > gmax) { lo -= hi - gmax; hi = gmax; }
  lo = Math.max(lo, gmin);
  return { lo, hi, level: (lo + hi) / 2, width: hi - lo };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}


/** Whether the drag readout (components/WindowDragHud.jsx) shows. Not on the
 *  press: a right-click that doesn't move opens the image menu, and the
 *  readout used to appear behind it. It shows once the pointer has moved past
 *  the same slop that tells a click from a drag, then stays for the drag. */
export function dragHudVisible({ phase, start, pointer, shown }) {
  if (shown) return true;
  if (phase !== "move" || !start || !pointer) return false;
  return Math.hypot(pointer.x - start.x, pointer.y - start.y) > RIGHT_CLICK_SLOP_PX;
}
