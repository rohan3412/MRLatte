import { readPrefs, getPref, writePref } from "./preferences";
import { BUILT_IN_PRESETS, allPresets, applyPreset, saveAsNew, saveEdit, resetEdit, deleteCustom, cleanPreset } from "./presets";

beforeEach(() => { localStorage.clear(); readPrefs(); });
const preset = (id) => allPresets().find((p) => p.id === id);

test("six built-in presets, Everything first, each explained", () => {
  expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual(
    ["everything", "lesion-tracing", "lesion-analysis", "visual-field", "functional", "reading"]);
  for (const p of BUILT_IN_PRESETS) expect(p.detail.length).toBeGreaterThan(60);
});

test("applying a preset shows its sections in its order, hides the rest, and sets how the viewer opens", () => {
  applyPreset(preset("lesion-tracing"));
  expect(getPref("hiddenSections")).toEqual(expect.arrayContaining(["section-lnm", "section-tracts", "section-retinotopy"]));
  expect(getPref("hiddenSections")).not.toContain("section-drawing");
  expect(getPref("sectionOrder").slice(0, 2)).toEqual(["section-base", "section-drawing"]);
  expect(getPref("startLayout")).toBe("axial");
  expect(getPref("activePreset")).toBe("lesion-tracing");
});

test("Everything puts back the default order, its headings and every section", () => {
  applyPreset(preset("reading"));
  applyPreset(preset("everything"));
  expect(getPref("sectionOrder")).toEqual([]);
  expect(getPref("hiddenSections")).toEqual([]);
  expect(getPref("startLayout")).toBe("multiplanar");
  expect(getPref("idleQc")).toBe(true);
});

test("your own preset is the current setup under a name, and can be deleted", () => {
  applyPreset(preset("functional"));
  writePref("startWhiteBackground", true);
  const id = saveAsNew("  Figures  ");
  const mine = preset(id);
  expect(mine).toMatchObject({ name: "Figures", custom: true, sections: preset("functional").sections });
  expect(mine.start.startWhiteBackground).toBe(true);
  deleteCustom(id);
  expect(preset(id)).toBeUndefined();
  expect(getPref("activePreset")).toBe("");
});

test("a built-in edited to the current setup can be reset to its default", () => {
  applyPreset(preset("reading"));
  writePref("hiddenSections", ["section-longitudinal", ...getPref("hiddenSections")]);
  saveEdit("reading");
  expect(preset("reading").edited).toBe(true);
  expect(preset("reading").sections).not.toContain("section-longitudinal");
  resetEdit("reading");
  expect(preset("reading").edited).toBeUndefined();
  expect(preset("reading").sections).toContain("section-longitudinal");
});

test("a stored preset keeps only known sections and start-up keys of the right type", () => {
  expect(cleanPreset({ id: "x", name: "", sections: ["section-base", "nope"], start: { startLayout: "axial", idleQc: "yes", evil: 1 } }))
    .toEqual({ id: "x", name: "My preset", sections: ["section-base"], start: { startLayout: "axial" } });
  expect(cleanPreset({ name: "no id" })).toBeNull();
});
