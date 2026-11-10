import { shuffledOrder, lodInstanceCount } from "./streamlineOrder";

describe("shuffledOrder", () => {
  test("is a permutation of 0..n-1", () => {
    const o = Array.from(shuffledOrder(500, 7)).sort((a, b) => a - b);
    expect(o).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });
  test("is deterministic for the same seed", () => {
    expect(Array.from(shuffledOrder(100, 3))).toEqual(Array.from(shuffledOrder(100, 3)));
  });
  test("different seeds differ", () => {
    expect(Array.from(shuffledOrder(100, 1))).not.toEqual(Array.from(shuffledOrder(100, 2)));
  });
  test("handles empty and single", () => {
    expect(shuffledOrder(0, 1).length).toBe(0);
    expect(Array.from(shuffledOrder(1, 1))).toEqual([0]);
  });
});

describe("lodInstanceCount", () => {
  test("full at fraction >= 1", () => {
    expect(lodInstanceCount(1000, 1)).toBe(1000);
    expect(lodInstanceCount(1000, 2)).toBe(1000);
  });
  test("rounds up, at least one", () => {
    expect(lodInstanceCount(1000, 0.25)).toBe(250);
    expect(lodInstanceCount(7, 0.1)).toBe(1);
    expect(lodInstanceCount(3, 0.01)).toBe(1);
  });
  test("zero when empty", () => {
    expect(lodInstanceCount(0, 0.5)).toBe(0);
    expect(lodInstanceCount(0, 1)).toBe(0);
  });
});
