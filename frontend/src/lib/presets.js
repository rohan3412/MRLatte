import { DEFAULT_PREFS, getPref, writePref } from "@/lib/preferences";
import { SECTION_IDS, effectiveOrder } from "@/lib/sections";

// Presets (owner, 5 Nov): one choice that sets which sidebar sections show, in
// what order, and how the viewer opens. Built-in ones can be edited (and reset
// to their default); your own are saved from the current setup. Applying a
// preset only writes ordinary preferences, so everything it sets can still be
// changed one by one afterwards.

// The start-up preferences a preset carries.
export const PRESET_START_KEYS = ["startRadiological", "startLayout", "startWhiteBackground",
  "startCrosshair", "crosshairColor", "crosshairWidth", "idleQc", "idleQcSeconds"];

export const BUILT_IN_PRESETS = [
  {
    id: "everything",
    name: "Everything",
    summary: "Every section, the way MRLatte has always looked.",
    detail: "All twelve sections under their Volumes, Analysis and Reference headings. Nothing is hidden, so nothing is ever out of reach; the other presets are this with the sections a task doesn't use taken away.",
    sections: SECTION_IDS,
    start: {},
  },
  {
    id: "lesion-tracing",
    name: "Lesion tracing",
    summary: "Drawing lesions by hand and checking them.",
    detail: "Opens on a single axial slice with the crosshair on, Draw mask right under the scan, and the background quality check on. Keeps Lesion masks, Report, Atlases and Measurements & window; leaves out the analyses (tracts, network mapping, longitudinal, retinotopy) you don't need while drawing.",
    sections: ["section-base", "section-drawing", "section-lesion", "section-report", "section-atlases", "section-measure"],
    start: { startLayout: "axial", startCrosshair: true, idleQc: true },
  },
  {
    id: "lesion-analysis",
    name: "Lesion analysis",
    summary: "What a lesion disconnects and what it touches.",
    detail: "Lesion masks and the Report first, then tract dissection, lesion network mapping and tractography, with atlases for the regions. Unlike Lesion tracing it leaves out drawing and opens on all views with 3D. Network mapping and dissection need their modules.",
    sections: ["section-base", "section-lesion", "section-report", "section-tract-dissect", "section-lnm", "section-tracts", "section-atlases"],
    start: { startLayout: "multiplanar" },
  },
  {
    id: "visual-field",
    name: "Visual field",
    summary: "Which part of the visual field a lesion affects.",
    detail: "Lesion masks, Retinotopy (the Benson and Wang maps and the deficit maps) and the Report, with atlases. The one preset built around retinotopy; everything for drawing, tracts and network mapping is left out.",
    sections: ["section-base", "section-lesion", "section-retinotopy", "section-report", "section-atlases"],
    start: { startLayout: "multiplanar" },
  },
  {
    id: "functional",
    name: "Functional maps",
    summary: "Activation maps and their clusters.",
    detail: "Activation maps with cluster analysis, atlases to name the regions, and Measurements & window. No lesion tools at all: this is for statistical maps, not lesions.",
    sections: ["section-base", "section-activation", "section-atlases", "section-measure"],
    start: { startLayout: "multiplanar" },
  },
  {
    id: "reading",
    name: "Reading",
    summary: "Looking at scans and comparing visits.",
    detail: "The scan, atlases, Measurements & window and Longitudinal for a follow-up. The quietest preset: no analysis sections and no background checks.",
    sections: ["section-base", "section-atlases", "section-measure", "section-longitudinal"],
    start: { startLayout: "multiplanar", idleQc: false },
  },
];

const BUILT_IN_IDS = BUILT_IN_PRESETS.map((p) => p.id);

// A preset as stored (an edited built-in or your own): only known sections and
// start-up keys of the right type survive.
export function cleanPreset(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) return null;
  const sections = Array.isArray(p.sections) ? p.sections.filter((s) => SECTION_IDS.includes(s)) : [];
  const start = {};
  for (const k of PRESET_START_KEYS) {
    if (p.start && typeof p.start[k] === typeof DEFAULT_PREFS[k]) start[k] = p.start[k];
  }
  return { id: p.id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "My preset", sections, start };
}

/** Every preset: the built-ins (with your edits) then your own. */
export function allPresets() {
  const edits = getPref("presetEdits");
  const own = getPref("customPresets");
  return [
    ...BUILT_IN_PRESETS.map((p) => {
      const e = cleanPreset({ ...edits[p.id], id: p.id, name: p.name });
      return edits[p.id] ? { ...p, sections: e.sections, start: e.start, edited: true } : p;
    }),
    ...own.map((p) => ({ ...cleanPreset(p), custom: true })),
  ];
}

/** The current setup, as a preset would hold it. */
export function currentSetup() {
  const leftOut = getPref("hiddenSections");
  return {
    sections: effectiveOrder(getPref("sectionOrder")).filter((id) => !leftOut.includes(id)),
    start: Object.fromEntries(PRESET_START_KEYS.map((k) => [k, getPref(k)])),
  };
}

/** Make `p` the setup: its sections in its order (the rest left out, after
 *  them), its start-up values over the defaults. */
export function applyPreset(p) {
  const order = effectiveOrder(p.sections);
  writePref("sectionOrder", order.every((id, i) => id === SECTION_IDS[i]) ? [] : order);
  writePref("hiddenSections", SECTION_IDS.filter((id) => !p.sections.includes(id)));
  for (const k of PRESET_START_KEYS) writePref(k, k in p.start ? p.start[k] : DEFAULT_PREFS[k]);
  writePref("activePreset", p.id);
}

/** Built-in: remember the current setup as its new content. */
export function saveEdit(id) {
  if (!BUILT_IN_IDS.includes(id)) return;
  writePref("presetEdits", { ...getPref("presetEdits"), [id]: currentSetup() });
}

export function resetEdit(id) {
  const { [id]: _gone, ...rest } = getPref("presetEdits");
  writePref("presetEdits", rest);
}

/** Your own: the current setup under a name. Returns its id. */
export function saveAsNew(name) {
  const id = `custom-${Date.now().toString(36)}`;
  writePref("customPresets", [...getPref("customPresets"), cleanPreset({ id, name, ...currentSetup() })]);
  writePref("activePreset", id);
  return id;
}

export function deleteCustom(id) {
  writePref("customPresets", getPref("customPresets").filter((p) => p.id !== id));
  if (getPref("activePreset") === id) writePref("activePreset", "");
}
