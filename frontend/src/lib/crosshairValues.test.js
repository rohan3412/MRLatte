import { publishCrosshairValues, getCrosshairValue, subscribeCrosshairValues, valuesByLayer, markerFraction, insideGrid } from "./crosshairValues";

test("valuesByLayer keys by volume name and canonical id, skipping non-finite values", () => {
  const rows = [{ name: "a-1", value: 3 }, { name: "benson14_polar_angle", value: 90 }, { name: "gone", value: NaN }];
  const canon = (n) => (n === "benson14_polar_angle" ? "benson_polar_angle" : n);
  expect(valuesByLayer(rows, canon)).toEqual({ "a-1": 3, benson14_polar_angle: 90, benson_polar_angle: 90 });
});

test("publishing replaces the values and tells subscribers; unknown layers read undefined", () => {
  const seen = [];
  const off = subscribeCrosshairValues(() => seen.push(getCrosshairValue("x")));
  publishCrosshairValues({ x: 2 });
  publishCrosshairValues({});
  off();
  publishCrosshairValues({ x: 9 });
  expect(seen).toEqual([2, undefined]);
  expect(getCrosshairValue("x")).toBe(9);
  expect(getCrosshairValue("nope")).toBeUndefined();
});

test("markerFraction is the position in the range, or null outside it", () => {
  expect(markerFraction(5, 0, 10)).toBe(0.5);
  expect(markerFraction(0, 0, 10)).toBe(0);
  expect(markerFraction(10, 0, 10)).toBe(1);
  expect(markerFraction(-3, 0, 10)).toBeNull();
  expect(markerFraction(11, 0, 10)).toBeNull();
  expect(markerFraction(undefined, 0, 10)).toBeNull();
  expect(markerFraction(1, 4, 4)).toBeNull();
});

test("insideGrid: a voxel outside a smaller layer has no value there", () => {
  const dims = [3, 30, 30, 30];
  expect(insideGrid([0, 0, 0], dims)).toBe(true);
  expect(insideGrid([29, 29, 29], dims)).toBe(true);
  expect(insideGrid([29.4, 0, 0], dims)).toBe(true);
  expect(insideGrid([30, 5, 5], dims)).toBe(false);
  expect(insideGrid([5, -1, 5], dims)).toBe(false);
  expect(insideGrid([5, 5, NaN], dims)).toBe(false);
  expect(insideGrid([5, 5, 5], undefined)).toBe(true);
  expect(insideGrid(undefined, dims)).toBe(true);
});
