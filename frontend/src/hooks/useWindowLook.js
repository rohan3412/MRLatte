import { useEffect } from "react";
import { usePreference } from "@/lib/preferences";

// Preferences ▸ Transparency and Performance mode (owner, 5 Nov). Transparency
// sets how much of the app shows, blurred, through the frosted surfaces: menus,
// dialogs, the readout chip and floating panels. The window itself is opaque:
// letting the desktop show through it (Windows acrylic, macOS vibrancy) left
// faint leftovers on screen on Windows and was removed (owner, 12 Nov).
// Performance mode turns the frosting off, along with the visual effects
// (lib/viewer/effects.js).
export function useWindowLook() {
  const [transparency] = usePreference("transparency");
  const [performance] = usePreference("performanceMode");

  // Frosted surfaces (menus, dialogs, the readout chip, floating panels): the panel colour at
  // (1 - transparency) alpha; solid in Performance mode (index.css .frosted).
  useEffect(() => {
    document.documentElement.style.setProperty("--frost-alpha", performance ? "1" : String(1 - transparency / 100));
  }, [performance, transparency]);

  // Text size (desktop app: the page zoom) and density (index.css).
  const [uiScale] = usePreference("uiScale");
  const [density] = usePreference("density");
  useEffect(() => { window.mrlatte?.setUiScale?.(uiScale / 100); }, [uiScale]);
  useEffect(() => {
    if (density === "compact") document.documentElement.dataset.density = "compact";
    else delete document.documentElement.dataset.density;
  }, [density]);

  // Styles that blur (the first-run questionnaire's backdrop) check this.
  useEffect(() => {
    if (performance) document.documentElement.dataset.performance = "";
    else delete document.documentElement.dataset.performance;
  }, [performance]);
}
