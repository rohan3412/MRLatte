import { buildLesionAtlasSection, buildRetinotopySection } from "./sections";

test("an atlas the lesion doesn't touch says so instead of showing an empty heading", () => {
  const { html } = buildLesionAtlasSection({ atlasBreakdowns: [{ atlasName: "Destrieux", rows: [] }] });
  expect(html).toContain("Destrieux");
  expect(html).toContain("overlaps no region of this atlas");
});

test("regions all under 1% of the lesion get the small-regions note and a fold", () => {
  const { html } = buildLesionAtlasSection({ atlasBreakdowns: [{ atlasName: "AAL", rows: [
    { regionName: "Thalamus", voxelCount: 3, percentOfLesion: 0.5, percentOfRegion: 0.1 },
  ] }] });
  expect(html).toContain("No region covers 1% of the lesion or more.");
  expect(html).not.toContain("overlaps no region");
  expect(html).toContain("1 more region");
});

test("the visual field table has no raw 'kind' column", () => {
  const { html } = buildRetinotopySection([{ name: "Polar Angle (0–360°)", kind: "polar", summary: "no overlap" }]);
  expect(html).not.toContain(">Kind<");
  expect(html).not.toContain(">polar<");
  expect(html).toContain("Polar Angle (0–360°)");
});
