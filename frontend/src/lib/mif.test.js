// NiiVue (ES modules) isn't loaded under Jest; the conversion itself is
// checked in the running app with a real .mif.
jest.mock("@niivue/niivue", () => ({ NVImage: {} }));
// eslint-disable-next-line import/first
import { isMifName, niftiNameForMif, niftiFileFor, niftiReadResult } from "./mif";

test("which names are MRtrix images, and what they become", () => {
  expect(isMifName("dwi.mif")).toBe(true);
  expect(isMifName("FOD.MIF.GZ")).toBe(true);
  expect(isMifName("t1.nii.gz")).toBe(false);
  expect(isMifName("notes.mif.txt")).toBe(false);
  expect(niftiNameForMif("lesion.mif.gz")).toBe("lesion.nii");
  expect(niftiNameForMif("a.b.mif")).toBe("a.b.nii");
});

test("anything that isn't a .mif passes through untouched", async () => {
  const f = new File([new Uint8Array([1, 2, 3])], "t1.nii.gz");
  expect(await niftiFileFor(f)).toBe(f);
  const res = { ok: true, name: "t1.nii", bytes: new Uint8Array(4) };
  expect(await niftiReadResult(res)).toBe(res);
  const failed = { ok: false, error: "ENOENT", name: "x.mif" };
  expect(await niftiReadResult(failed)).toBe(failed);
});
