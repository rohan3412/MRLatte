import { niceStep, snapValue } from "./sliderMath";

test("niceStep picks 1, 2 or 5 times a power of ten, about a hundredth of the range", () => {
  expect(niceStep(0, 100)).toBe(1);
  expect(niceStep(0, 10)).toBe(0.1);
  expect(niceStep(0, 1)).toBe(0.01);
  expect(niceStep(-5, 15)).toBe(0.2);
  expect(niceStep(0, 500)).toBe(5);
  expect(niceStep(0, 100, true)).toBe(1);
  expect(niceStep(0, 5, true)).toBe(1);        // whole numbers never step below 1
});

test("snapValue catches a value close to a snap point, and only then", () => {
  const snaps = [0, 50, 100];
  expect(snapValue(49, snaps, 0, 100)).toEqual({ value: 50, snapped: true });
  expect(snapValue(51.5, snaps, 0, 100)).toEqual({ value: 50, snapped: true });
  expect(snapValue(47, snaps, 0, 100)).toEqual({ value: 47, snapped: false });
  expect(snapValue(1, snaps, 0, 100)).toEqual({ value: 0, snapped: true });
  expect(snapValue(49, [], 0, 100)).toEqual({ value: 49, snapped: false });
  expect(snapValue(49, snaps, 0, 100, { bypass: true })).toEqual({ value: 49, snapped: false });
});
