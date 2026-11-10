// The sidebar's sections, in their default order (Dashboard.jsx renders them
// in this order under the Volumes / Analysis / Reference headings). Preferences
// ▸ Sidebar reorders and hides them by these ids, which are each section's
// testId; presets (lib/presets.js) are built from them too.
export const SECTIONS = [
  { id: "section-base", title: "Base volume", group: "Volumes" },
  { id: "section-lesion", title: "Lesion masks", group: "Volumes" },
  { id: "section-drawing", title: "Draw mask", group: "Volumes" },
  { id: "section-activation", title: "Activation maps", group: "Volumes" },
  { id: "section-tracts", title: "Tractography", group: "Volumes" },
  { id: "section-report", title: "Report", group: "Analysis" },
  { id: "section-tract-dissect", title: "Tract dissection", group: "Analysis" },
  { id: "section-lnm", title: "Lesion network mapping", group: "Analysis" },
  { id: "section-measure", title: "Measurements & window", group: "Analysis" },
  { id: "section-longitudinal", title: "Longitudinal", group: "Analysis" },
  { id: "section-atlases", title: "Atlases", group: "Reference" },
  { id: "section-retinotopy", title: "Retinotopy", group: "Reference" },
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

/** A saved order completed into a full one: its known ids first, then every
 *  section it leaves out (one added in a later version) in default order. */
export function effectiveOrder(saved) {
  const known = (saved || []).filter((id) => SECTION_IDS.includes(id));
  return [...new Set([...known, ...SECTION_IDS])];
}
