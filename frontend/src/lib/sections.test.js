import { SECTIONS, effectiveOrder } from "./sections";
import { readPrefs, writePref, getPref } from "./preferences";

beforeEach(() => { localStorage.clear(); readPrefs(); });

test("the catalogue is the twelve sidebar sections in today's order", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual([
    "section-base", "section-lesion", "section-drawing", "section-activation", "section-tracts",
    "section-report", "section-tract-dissect", "section-lnm", "section-measure", "section-longitudinal",
    "section-atlases", "section-retinotopy",
  ]);
});

test("a partial or stale saved order is completed with the rest, in default order", () => {
  expect(effectiveOrder(["section-report", "section-base", "section-gone"]).slice(0, 4))
    .toEqual(["section-report", "section-base", "section-lesion", "section-drawing"]);
  expect(effectiveOrder([])).toEqual(SECTIONS.map((s) => s.id));
});

test("section lists in preferences only keep known ids", () => {
  writePref("sectionOrder", ["section-lnm", "section-base"]);
  writePref("hiddenSections", ["section-longitudinal"]);
  expect(getPref("sectionOrder")).toEqual(["section-lnm", "section-base"]);
  expect(getPref("hiddenSections")).toEqual(["section-longitudinal"]);
  writePref("hiddenSections", ["section-longitudinal", "not-a-section"]);
  expect(getPref("hiddenSections")).toEqual(["section-longitudinal"]);   // refused, unchanged
  localStorage.setItem("mrlatte-prefs", JSON.stringify({ sectionOrder: "section-base" }));
  expect(readPrefs().sectionOrder).toEqual([]);
});
