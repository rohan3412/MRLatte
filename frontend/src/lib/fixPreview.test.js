import { startFixPreview, applyFixPreview, cancelFixPreview, getFixPreview } from "./fixPreview";
import { fetchFixPlan, uploadLesion, hasFeature } from "@/lib/lesionMetrics";
import { currentDrawingAsFile } from "@/lib/lesions";

jest.mock("@/lib/lesionMetrics", () => ({
  ...jest.requireActual("@/lib/lesionMetrics"),
  fetchFixPlan: jest.fn(),
  uploadLesion: jest.fn(),
}));
jest.mock("@/lib/lesions", () => ({ currentDrawingAsFile: jest.fn() }));

const b64 = btoa("mask");
const viewer = () => ({
  addOverlayFromFile: jest.fn(async () => ({})),
  removeOverlayByName: jest.fn(),
  applyFixMasks: jest.fn(async ({ added, removed }) => ({ added: added ? 5 : 0, removed: removed ? 1 : 0 })),
  getDrawingContext: () => ({ drawing_axis: 2 }),
});
const gaps = { id: "sparse_slices", label: "Check, moderate", advice: { fix_id: "sparse_slices", adds_voxels: true } };

// CRA resets mock implementations before each test: set them here.
beforeEach(() => {
  cancelFixPreview();
  uploadLesion.mockResolvedValue("a".repeat(64));
  currentDrawingAsFile.mockResolvedValue(new File(["x"], "d.nii.gz"));
});

test("a fix that adds voxels is shown in green, then applied as one edit", async () => {
  fetchFixPlan.mockResolvedValue({ fixes: [{ id: "sparse_slices", voxels_added: 5, voxels_removed: 0, added_mask: b64, removed_mask: b64 }] });
  const viewerRef = { current: viewer() };
  const fix = await startFixPreview({ viewerRef, finding: gaps, mni: false });
  expect(fix.id).toBe("sparse_slices");
  // Planned from the drawing as it is now, for this finding only, with the drawing's context.
  expect(currentDrawingAsFile).toHaveBeenCalled();
  expect(uploadLesion).toHaveBeenCalled();
  expect(fetchFixPlan).toHaveBeenCalledWith(expect.objectContaining({
    findingIds: ["sparse_slices"], mni: false, context: { labels_are_colours: true, drawing_axis: 2 } }));
  expect(viewerRef.current.addOverlayFromFile).toHaveBeenCalledTimes(1);
  expect(viewerRef.current.addOverlayFromFile.mock.calls[0][1]).toMatchObject({ colormap: "green" });
  expect(getFixPreview()).not.toBeNull();

  const res = await applyFixPreview();
  expect(res).toEqual({ added: 5, removed: 0 });
  expect(viewerRef.current.applyFixMasks).toHaveBeenCalledTimes(1);
  expect(viewerRef.current.removeOverlayByName).toHaveBeenCalled();
  expect(getFixPreview()).toBeNull();
});

test("Cancel removes the preview and changes nothing", async () => {
  fetchFixPlan.mockResolvedValue({ fixes: [{ id: "specks", voxels_added: 0, voxels_removed: 1, added_mask: b64, removed_mask: b64 }] });
  const viewerRef = { current: viewer() };
  await startFixPreview({ viewerRef, finding: { id: "specks", advice: { fix_id: "specks" } } });
  expect(viewerRef.current.addOverlayFromFile.mock.calls[0][1]).toMatchObject({ colormap: "blue" });
  cancelFixPreview();
  expect(getFixPreview()).toBeNull();
  expect(viewerRef.current.applyFixMasks).not.toHaveBeenCalled();
  expect(await applyFixPreview()).toBeNull();
});

test("a fix that would change nothing shows nothing", async () => {
  fetchFixPlan.mockResolvedValue({ fixes: [] });
  const viewerRef = { current: viewer() };
  expect(await startFixPreview({ viewerRef, finding: gaps })).toBeNull();
  expect(viewerRef.current.addOverlayFromFile).not.toHaveBeenCalled();
  expect(getFixPreview()).toBeNull();
});

test("features are read from the backend's capabilities", () => {
  expect(hasFeature({ available: true, features: ["qc.fix_plan"] }, "qc.fix_plan")).toBe(true);
  expect(hasFeature({ available: true, features: [] }, "qc.fix_plan")).toBe(false);
  expect(hasFeature({ available: true }, "compare")).toBe(false);          // lqtpy before 0.8.0
  expect(hasFeature({ available: false, features: ["compare"] }, "compare")).toBe(false);
  expect(hasFeature(null, "compare")).toBe(false);
});
