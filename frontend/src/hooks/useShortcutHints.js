import { useEffect } from "react";

// Hold Ctrl (Cmd on a Mac) on its own for a moment and every button that has a
// single-key shortcut shows its key, for as long as it is held (owner, 5 Nov).
// Pressing any other key (Ctrl+Z, Ctrl+S…) cancels it at once, so working
// shortcuts never flash hints. `keys` maps a CSS selector to the key's label;
// the label lands in a data-shortcut attribute that index.css draws.
const HOLD_MS = 450;

export function useShortcutHints(keys) {
  useEffect(() => {
    let timer = null;
    const root = document.documentElement;
    const hide = () => {
      clearTimeout(timer);
      timer = null;
      if (!("shortcutHints" in root.dataset)) return;
      delete root.dataset.shortcutHints;
      document.querySelectorAll("[data-shortcut]").forEach((el) => el.removeAttribute("data-shortcut"));
    };
    const show = () => {
      for (const [selector, label] of Object.entries(keys)) {
        document.querySelectorAll(selector).forEach((el) => el.setAttribute("data-shortcut", label));
      }
      root.dataset.shortcutHints = "";
    };
    const onDown = (e) => {
      const modifierAlone = e.key === "Control" || e.key === "Meta";
      if (!modifierAlone) { hide(); return; }
      if (!e.repeat && !timer) timer = setTimeout(show, HOLD_MS);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("pointerdown", hide, true);
    return () => {
      hide();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("pointerdown", hide, true);
    };
    // The map is a constant at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
