import { lockedColorRange, robustRange, flattenOverlap, overlapToCSV, findClusters, nativeMMToVox } from "./volumeAnalysis";

describe("colour range locked to the visibility values", () => {
  test("a visibility window: the colour range is that window", () => {
    expect(lockedColorRange({ global_min: 0, global_max: 90 }, 20, 60)).toEqual([20, 60]);
  });
  test("an inverted threshold on a positive map: from the threshold to the maximum", () => {
    // Stat-map default: hide −1…1, show the rest. Locking to −1…1 itself
    // would saturate every visible voxel.
    expect(lockedColorRange({ invertThreshold: true, global_min: 0, global_max: 91.5 }, -1, 1)).toEqual([1, 91.5]);
  });
  test("an inverted threshold on a two-sided map: everything visible, both tails", () => {
    expect(lockedColorRange({ invertThreshold: true, global_min: -8, global_max: 6 }, -3, 3)).toEqual([-8, 6]);
  });
  test("an inverted threshold on a negative map: from the minimum to the threshold", () => {
    expect(lockedColorRange({ invertThreshold: true, global_min: -10, global_max: 0 }, -2, 2)).toEqual([-10, -2]);
  });
  test("no data range known: falls back to the visibility values", () => {
    expect(lockedColorRange({ invertThreshold: true }, -1, 1)).toEqual([-1, 1]);
  });
});

describe("robust range of an integer volume with a scale factor", () => {
  // niivue keeps vol.img raw for scaled integer NIfTI (e.g. the MNI152
  // template: uint8, scl_slope ≈ 0.3587); the window must come back in the
  // displayed units that cal_min/cal_max and global_min/max use.
  const img = new Uint8Array(200); // zeros: background, skipped
  img.fill(1, 0, 5);
  img.fill(128, 5, 95);
  img.fill(255, 95, 100);
  test("the window is in scaled units", () => {
    const [lo, hi] = robustRange({ img, hdr: { scl_slope: 0.5, scl_inter: 10 } });
    expect(lo).toBeCloseTo(10.5); // 1 * 0.5 + 10
    expect(hi).toBeCloseTo(137.5); // 255 * 0.5 + 10
  });
  test("a negative slope still returns [lo, hi]", () => {
    const [lo, hi] = robustRange({ img, hdr: { scl_slope: -0.5, scl_inter: 0 } });
    expect(lo).toBeCloseTo(-127.5);
    expect(hi).toBeCloseTo(-0.5);
  });
});

describe("overlap table across several atlases", () => {
  const row = (regionName, voxelCount, percentOfLesion, percentOfRegion) => ({ regionName, voxelCount, percentOfLesion, percentOfRegion });
  const breakdowns = [
    { atlasName: "AAL", rows: [row("Precentral_L", 120, 60, 2.5), row("Postcentral_L", 80, 40, 1.25)] },
    { atlasName: "HO cortical", rows: [row("Precentral Gyrus", 150, 75, 1)] },
    { atlasName: "Empty", rows: [] },
  ];

  test("rows keep their atlas, in atlas order", () => {
    const rows = flattenOverlap(breakdowns);
    expect(rows.map((r) => [r.atlasName, r.regionName])).toEqual([
      ["AAL", "Precentral_L"], ["AAL", "Postcentral_L"], ["HO cortical", "Precentral Gyrus"],
    ]);
  });

  test("the CSV has an atlas column and quotes names", () => {
    const csv = overlapToCSV(flattenOverlap([{ atlasName: 'A "x"', rows: [row("R, 1", 5, 50, 10)] }]));
    expect(csv.split("\n")).toEqual([
      "atlas,region,voxels,percent_of_lesion,percent_of_region",
      '"A ""x""","R, 1",5,50.00,10.00',
    ]);
  });
});

// A volume as NiiVue hands it over: img in the file's own voxel order,
// hdr.affine (rows) the file's voxel → world mm, and matRAS the same matrix
// stored row by row in a gl-matrix array (translation in slots 3, 7, 11).
function niivueVolume(affine, [nx, ny, nz], fill) {
  const img = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) img[i + nx * (j + ny * k)] = fill(i, j, k);
  return {
    img,
    hdr: { dims: [3, nx, ny, nz, 1, 1, 1, 1], affine },
    dimsRAS: [3, nx, ny, nz],
    matRAS: Float32Array.from([...affine[0], ...affine[1], ...affine[2], 0, 0, 0, 1]),
  };
}
// Highest at the centre, so the peak is one voxel.
const ball = (c, r) => (i, j, k) => { const d = Math.hypot(i - c[0], j - c[1], k - c[2]); return d <= r ? 5 - d : 0; };

describe("cluster peak positions", () => {
  test("include the scan's origin (Go to peak used to land outside the brain)", () => {
    const vol = niivueVolume([[4, 0, 0, -80], [0, 4, 0, -110], [0, 0, 4, -70]], [40, 48, 40], ball([12, 20, 22], 2));
    const [c] = findClusters(vol, 2.3, "pos", 5).clusters;
    expect(c.peakMM.map((x) => Math.round(x))).toEqual([-32, -30, 18]);
    expect(c.centerMM.map((x) => Math.round(x))).toEqual([-32, -30, 18]);
  });

  test("stay on the right side for a map stored left-right flipped (FSL's MNI grid)", () => {
    // FSL standard space: x runs right → left in the file (negative x step).
    const vol = niivueVolume([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72]], [91, 109, 91], ball([65, 50, 60], 2));
    const [c] = findClusters(vol, 2.3, "pos", 5).clusters;
    expect(c.peakMM.map((x) => Math.round(x))).toEqual([-40, -26, 48]); // left hemisphere
  });

  test("a world position maps back to the file's voxel", () => {
    const vol = niivueVolume([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72]], [91, 109, 91], () => 0);
    expect(nativeMMToVox(vol, [-40, -26, 48]).map((x) => Math.round(x))).toEqual([65, 50, 60]);
  });
});
