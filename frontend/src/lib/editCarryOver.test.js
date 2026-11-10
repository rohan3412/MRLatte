import { captureLayerStyle, rangesToReapply } from "./editCarryOver";

describe("captureLayerStyle", () => {
  test("keeps the colour map and opacity the user chose", () => {
    const s = captureLayerStyle({ colormap: "red", opacity: 0.6 }, {});
    expect(s.colormap).toBe("red");
    expect(s.opacity).toBe(0.6);
  });
  test("keeps the ranges, lock and inversion from overlayMeta", () => {
    const s = captureLayerStyle({ colormap: "red", opacity: 1 },
      { cal_min: 0.5, cal_max: 1, color_min: 0, color_max: 2, colorLocked: true, colormapInverted: true });
    expect(s).toMatchObject({ calMin: 0.5, calMax: 1, colorMin: 0, colorMax: 2, colorLocked: true, colormapInverted: true });
  });
  test("no layer, nothing to carry", () => {
    expect(captureLayerStyle(undefined, {})).toBeNull();
  });
});

describe("rangesToReapply", () => {
  const style = { calMin: 0.5, calMax: 1, colorMin: 0, colorMax: 3 };
  test("both ranges carry when the saved mask still reaches the visibility range", () => {
    expect(rangesToReapply(style, 1)).toEqual({ cal: [0.5, 1], color: [0, 3] });
  });
  test("a visibility range above every value would hide the mask, so it is dropped", () => {
    expect(rangesToReapply({ ...style, calMin: 2, calMax: 5 }, 1)).toEqual({ color: [0, 3] });
  });
  test("unknown data range: carry what was set", () => {
    expect(rangesToReapply(style, undefined)).toEqual({ cal: [0.5, 1], color: [0, 3] });
  });
  test("nothing set, nothing re-applied", () => {
    expect(rangesToReapply({}, 1)).toEqual({});
    expect(rangesToReapply(null, 1)).toEqual({});
  });
});
