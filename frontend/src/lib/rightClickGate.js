// Decides when a right-click on the image opens its menu. The image's menu
// opens only for a right-click that didn't move: a right-DRAG zooms, windows
// or pans. Browsers fire `contextmenu` at different moments:
//   Windows / Linux: after the button is released (down → up → contextmenu);
//   macOS:           as soon as it is pressed     (down → contextmenu → up).
// Opening the menu straight from `contextmenu` therefore opened it at the
// start of every right-drag on a Mac, and the drag broke. Here, a
// `contextmenu` that arrives while the button is still down is held until the
// release, and the menu opens then only if the pointer stayed put.
export const RIGHT_CLICK_SLOP_PX = 4;

export function createRightClickGate(slop = RIGHT_CLICK_SLOP_PX) {
  let press = null; // { x, y, up, held } from right-button down until the menu decision

  const moved = (x, y) => Math.hypot(x - press.x, y - press.y) > slop;

  return {
    down(x, y) {
      press = { x, y, up: false, held: false };
    },
    // The browser asked for a menu. "open": show it now; "hold": wait for the
    // release (macOS); "skip": the pointer moved, so it was a drag.
    contextmenu(x, y) {
      if (!press) return "open"; // e.g. Ctrl+click on a Mac, the keyboard menu key
      if (!press.up) { press.held = true; return "hold"; }
      const verdict = moved(x, y) ? "skip" : "open";
      press = null;
      return verdict;
    },
    // Right button released. Returns true when a held menu should open now.
    up(x, y) {
      if (!press) return false;
      if (press.held) {
        const open = !moved(x, y);
        press = null;
        return open;
      }
      press.up = true; // Windows: contextmenu comes next and decides
      return false;
    },
    cancel() { press = null; },
  };
}
