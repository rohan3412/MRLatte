import { useSyncExternalStore } from "react";
import { SECTION_IDS } from "@/lib/sections";

// App preferences kept in this browser/profile. The look of the app
// (System / Light / Dark) is not here: it lives in hooks/use-theme.js because
// the desktop shell has to know it before the first window.
const STORAGE_KEY = "mrlatte-prefs";

// Each preference with its default. Only keys listed here are ever read or
// written, and a stored value of the wrong type falls back to the default.
export const DEFAULT_PREFS = {
  // Leave sections that need a module out of the sidebar and the rail,
  // instead of showing them greyed out with an Install prompt.
  hideUnavailableSections: false,
  // What the viewer looks like when MRLatte opens; the toolbar still changes
  // each of them for the session. A workspace that saved its own view wins.
  startRadiological: true,
  startLayout: "multiplanar",
  startWhiteBackground: false,
  startCrosshair: true,
  crosshairColor: "white",
  crosshairWidth: 1,
  // The drawing's background quality check after a pause in drawing.
  idleQc: true,
  idleQcSeconds: 30,
  // The brief effects over the viewer (lib/viewer/effects.js); what the coming
  // performance mode will switch off. Reduce Motion in the OS switches them off too.
  visualEffects: true,
  // How much of the desktop shows through the top bar, sidebar and menus
  // (0 = opaque, the default) over the OS material; hooks/useWindowLook.js.
  transparency: 20,
  // Off: transparency, frosted menus and the visual effects, all at once.
  performanceMode: false,
  // A system notification when a long job ends while MRLatte isn't in front.
  jobNotifications: true,
  // Draw the 3D view at a lower resolution while it is being rotated (as
  // Blender does). Its own setting; Performance mode turns it on too.
  lowResWhileRotating: false,
  // A layer's settings in a panel on the right (lib/inspector.js); the sidebar
  // keeps one line per layer. On by default for now (owner decides after use).
  inspectorPanel: true,
  // The crosshair readout: "chip" (a frosted chip in the viewer's bottom-left
  // corner) or "beside" (a small tag next to the crosshair on the active 2D tile).
  readout: "chip",
  // Preferences ▸ Panels. The task toolbar (a mode button swaps the Viewing tools
  // for the tools of the task at hand) and movable panels (a grip to dock or
  // float a panel), each with its own switch per kind; all off by default.
  taskToolbar: false,
  movablePanels: false,
  movableInspector: true,
  movableToolbar: true,
  movableReadout: true,
  movableSections: true,
  // Where the movable panels sit, per preset (lib/panelLayout.js).
  panelLayouts: {},
  // The toolbar docked left or right: icons only (false) or with names.
  toolbarExpanded: false,
  // Text size of the whole interface, in % (the desktop app's page zoom), and
  // spacing: "comfortable" (as designed) or "compact" (tighter rows).
  uiScale: 100,
  density: "comfortable",
  // Screenshots: saved straight to Pictures/MRLatte (false) or a save dialog.
  screenshotAsk: false,
  // Preferences ▸ Sidebar (lib/sections.js ids): a custom order ([] = the
  // default order, with its group headings) and the sections left out.
  sectionOrder: [],
  hiddenSections: [],
  // The buttons in the sidebar's top row (owner, 10 Nov), from HEADER_BUTTON_IDS.
  headerButtons: ["modules", "sections", "sidebar"],
  // Presets (lib/presets.js): the one in use, edited built-ins, your own.
  activePreset: "",
  presetEdits: {},
  customPresets: [],
  // First run (FirstRun.jsx): the questionnaire done or skipped, and the
  // version whose What's New was last shown.
  firstRunDone: false,
  whatsNewVersion: "",
};

// String preferences take one of these; number preferences an integer in range.
// The same values the toolbar offers (Dashboard SLICE_MODES, the crosshair panel).
export const PREF_CHOICES = {
  startLayout: ["multiplanar", "render", "axial", "coronal", "sagittal", "mosaic"],
  crosshairColor: ["white", "red", "yellow", "cyan", "green"],
  density: ["comfortable", "compact"],
  readout: ["chip", "beside"],
};
// The sidebar header's buttons, in the order they show (Dashboard draws them):
// the module store, collapse/expand all sections, light/dark mode, the command
// palette, screenshot, focus mode, keyboard shortcuts, Preferences, and
// collapse the sidebar.
export const HEADER_BUTTON_IDS = ["modules", "sections", "theme", "search", "screenshot", "focus", "shortcuts", "preferences", "sidebar"];
// List preferences: arrays of ids from this list.
export const PREF_LISTS = {
  sectionOrder: SECTION_IDS,
  hiddenSections: SECTION_IDS,
  headerButtons: HEADER_BUTTON_IDS,
};
export const PREF_RANGES = {
  crosshairWidth: [1, 5],
  idleQcSeconds: [10, 300],
  transparency: [0, 80],
  uiScale: [80, 150],
};

function valid(key, value) {
  if (!(key in DEFAULT_PREFS) || typeof value !== typeof DEFAULT_PREFS[key]) return false;
  if (PREF_LISTS[key]) return Array.isArray(value) && value.every((v) => PREF_LISTS[key].includes(v));
  // Shapes lib/presets.js cleans on read; here only the container is checked.
  if (key === "customPresets") return Array.isArray(value) && value.every((v) => v && typeof v === "object" && !Array.isArray(v));
  if (key === "panelLayouts") return !Array.isArray(value) && value !== null;
  if (key === "presetEdits") return !Array.isArray(value) && value !== null;
  if (PREF_CHOICES[key]) return PREF_CHOICES[key].includes(value);
  if (PREF_RANGES[key]) {
    const [lo, hi] = PREF_RANGES[key];
    return Number.isInteger(value) && value >= lo && value <= hi;
  }
  return true;
}

const listeners = new Set();
let cache = null;

export function readPrefs() {
  const out = { ...DEFAULT_PREFS };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (valid(key, stored?.[key])) out[key] = stored[key];
    }
  } catch (_e) { /* storage unavailable or corrupt: the defaults */ }
  cache = out;
  return out;
}

export function getPref(key) {
  if (!cache) readPrefs();
  return cache[key];
}

export function writePref(key, value) {
  if (!valid(key, value)) return;
  cache = { ...readPrefs(), [key]: value };
  try {
    // Only what differs from the defaults: a default changed in a later
    // version then reaches everyone who never chose otherwise.
    const same = (a, b) => (a && typeof a === "object" ? JSON.stringify(a) === JSON.stringify(b) : a === b);
    const changed = Object.fromEntries(Object.entries(cache).filter(([k, v]) => !same(v, DEFAULT_PREFS[k])));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch (_e) { /* storage unavailable: the choice holds for this session */ }
  listeners.forEach((fn) => fn());
}

export function subscribePrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** [value, set] for one preference, re-rendering when it changes. */
export function usePreference(key) {
  const read = () => getPref(key);
  const value = useSyncExternalStore(subscribePrefs, read, read);
  return [value, (next) => writePref(key, next)];
}
