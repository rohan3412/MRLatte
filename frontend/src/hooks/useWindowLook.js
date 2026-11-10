import { useEffect } from "react";
import { usePreference } from "@/lib/preferences";

// Preferences ▸ Transparency and Performance mode, applied to the window
// (owner, 5 Nov). Transparency lets the desktop show through the top bar,
// sidebar, readout and floating menus, over the OS material (Windows 11
// acrylic, macOS vibrancy: drawn by the OS compositor, so nearly free). The
// viewer itself always stays opaque. Performance mode turns all of it off,
// along with the visual effects (lib/viewer/effects.js).
//
// In the browser there is no OS material behind the page, so only the menus'
// frosted look applies there.
export function useWindowLook() {
  const [transparency] = usePreference("transparency");
  const [performance] = usePreference("performanceMode");
  // Only where an OS material sits behind the page (the desktop app); in the
  // browser the same alpha would just tint the sidebar over an empty page.
  const hasMaterial = typeof window !== "undefined" && !!window.mrlatte?.setWindowMaterial;
  const seeThrough = hasMaterial && transparency > 0 && !performance;

  useEffect(() => {
    const root = document.documentElement;
    if (seeThrough) {
      root.dataset.seeThrough = "";
      root.style.setProperty("--chrome-alpha", String(1 - transparency / 100));
    } else {
      delete root.dataset.seeThrough;
      root.style.removeProperty("--chrome-alpha");
    }
    window.mrlatte?.setWindowMaterial?.(seeThrough);
  }, [seeThrough, transparency]);

  // Frosted surfaces (the readout chip, floating panels): the panel colour at
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
