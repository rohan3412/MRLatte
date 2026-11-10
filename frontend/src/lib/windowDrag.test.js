import { windowFromDrag, windowFromLevelWidth, LEVEL_PX_PER_RANGE, WIDTH_PX_PER_E, FINE_DIVISOR, dragHudVisible } from "./windowDrag";

const ct = { startLo: 0, startHi: 80, gmin: -1024, gmax: 3071 }; // a brain window on CT
const unit = { startLo: 0.2, startHi: 0.6, gmin: 0, gmax: 1 }; // a 0–1 float map

describe("right-drag windowing", () => {
  test("no movement keeps the window", () => {
    const r = windowFromDrag({ ...ct, dx: 0, dy: 0 });
    expect(r.lo).toBeCloseTo(0);
    expect(r.hi).toBeCloseTo(80);
  });

  test("speed follows the data range: the same drag moves the same share of it", () => {
    const a = windowFromDrag({ ...ct, dx: 0, dy: -40 });
    const b = windowFromDrag({ ...unit, dx: 0, dy: -40 });
    expect((a.level - 40) / 4095).toBeCloseTo(0.1);
    expect((b.level - 0.4) / 1).toBeCloseTo(0.1);
    expect(a.level - 40).toBeCloseTo((40 * 4095) / LEVEL_PX_PER_RANGE);
  });

  test("drag up raises the level, drag right widens", () => {
    const up = windowFromDrag({ ...unit, dx: 0, dy: -20 });
    expect(up.level).toBeGreaterThan(0.4);
    expect(up.width).toBeCloseTo(0.4);
    const right = windowFromDrag({ ...unit, dx: WIDTH_PX_PER_E, dy: 0 });
    expect(right.width).toBeCloseTo(Math.min(0.4 * Math.E, 1));
    expect(windowFromDrag({ ...unit, dx: -30, dy: 0 }).width).toBeLessThan(0.4);
  });

  test("Shift is finer", () => {
    const coarse = windowFromDrag({ ...unit, dx: 0, dy: -50 });
    const fine = windowFromDrag({ ...unit, dx: 0, dy: -50, fine: true });
    expect(fine.level - 0.4).toBeCloseTo((coarse.level - 0.4) / FINE_DIVISOR);
  });

  test("stays inside the data range without collapsing", () => {
    const r = windowFromDrag({ ...unit, dx: 0, dy: -5000 });
    expect(r.hi).toBeCloseTo(1);
    expect(r.width).toBeCloseTo(0.4);
    const wide = windowFromDrag({ ...unit, dx: 5000, dy: 0 });
    expect(wide.lo).toBeCloseTo(0);
    expect(wide.hi).toBeCloseTo(1);
    const narrow = windowFromDrag({ ...unit, dx: -5000, dy: 0 });
    expect(narrow.width).toBeCloseTo(0.001);
  });
});

describe("window from level and width (base card sliders)", () => {
  test("centre and width map to lo/hi", () => {
    const r = windowFromLevelWidth({ level: 40, width: 80, gmin: -1024, gmax: 3071 });
    expect(r.lo).toBeCloseTo(0);
    expect(r.hi).toBeCloseTo(80);
  });

  test("width never exceeds the data range", () => {
    const r = windowFromLevelWidth({ level: 0.5, width: 5, gmin: 0, gmax: 1 });
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(1);
  });

  test("at an edge the window keeps its width and slides in", () => {
    const r = windowFromLevelWidth({ level: 0.05, width: 0.4, gmin: 0, gmax: 1 });
    expect(r.lo).toBeCloseTo(0);
    expect(r.hi).toBeCloseTo(0.4);
    const r2 = windowFromLevelWidth({ level: 2, width: 0.4, gmin: 0, gmax: 1 });
    expect(r2.hi).toBeCloseTo(1);
    expect(r2.lo).toBeCloseTo(0.6);
  });

  test("agrees with the drag: feeding a drag result back changes nothing", () => {
    const d = windowFromDrag({ ...unit, dx: 30, dy: -25 });
    const r = windowFromLevelWidth({ level: d.level, width: d.width, gmin: 0, gmax: 1 });
    expect(r.lo).toBeCloseTo(d.lo);
    expect(r.hi).toBeCloseTo(d.hi);
  });
});

// A plain right-click (no movement) opens the image menu; the drag readout
// must not appear for it, behind the menu (owner, 10 Nov).
describe("dragHudVisible", () => {
  const at = { x: 100, y: 100 };
  test("hidden on press", () => {
    expect(dragHudVisible({ phase: "start", start: at, pointer: at, shown: false })).toBe(false);
  });
  test("hidden for a release without movement", () => {
    expect(dragHudVisible({ phase: "end", start: at, pointer: { x: 101, y: 100 }, shown: false })).toBe(false);
  });
  test("shown once the pointer moves past the click slop", () => {
    expect(dragHudVisible({ phase: "move", start: at, pointer: { x: 103, y: 100 }, shown: false })).toBe(false);
    expect(dragHudVisible({ phase: "move", start: at, pointer: { x: 106, y: 100 }, shown: false })).toBe(true);
  });
  test("stays shown for the rest of the drag, and for its end", () => {
    expect(dragHudVisible({ phase: "move", start: at, pointer: at, shown: true })).toBe(true);
    expect(dragHudVisible({ phase: "end", start: at, pointer: at, shown: true })).toBe(true);
  });
});
