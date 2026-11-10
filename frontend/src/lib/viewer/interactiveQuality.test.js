import { createQualityController, LEVELS } from "./interactiveQuality";

// Feed `n` frames of `ms` each, 16 ms of wall time apart, starting at t0.
function feed(c, ms, n, t0 = 0) {
  let t = t0;
  for (let i = 0; i < n; i++) { c.frame(ms, t); t += 16; }
  return t;
}

describe("interactiveQuality", () => {
  test("levels start sharp", () => {
    expect(LEVELS[0]).toEqual({ stepScale: 1, tractFraction: 1, canvasScale: 1 });
  });

  test("fast machine stays at level 0", () => {
    const c = createQualityController();
    c.start();
    feed(c, 8, 500);
    expect(c.level).toBe(0);
    c.end();
    expect(c.start()).toBe(0);
  });

  test("sustained slow frames drop one level per window, max 3", () => {
    const c = createQualityController();
    c.start();
    let t = 0;
    const seen = [];
    for (let w = 0; w < 5; w++) {
      t = feed(c, 80, 20, t); // 320 ms of slow frames > one window
      seen.push(c.level);
    }
    expect(seen[0]).toBe(1);
    expect(seen[1]).toBe(2);
    expect(seen[2]).toBe(3);
    expect(seen[4]).toBe(3);
  });

  test("a single slow frame does not drop", () => {
    const c = createQualityController();
    c.start();
    c.frame(8, 0); c.frame(8, 100); c.frame(500, 200); c.frame(8, 300); c.frame(8, 400);
    expect(c.level).toBe(0);
  });

  test("never raises mid-interaction", () => {
    const c = createQualityController();
    c.start();
    const t = feed(c, 80, 20);
    expect(c.level).toBe(1);
    feed(c, 4, 200, t);
    expect(c.level).toBe(1);
  });

  test("raises one step per fast interaction after a drop", () => {
    const c = createQualityController();
    c.start();
    feed(c, 80, 40); // drops to 2
    const dropped = c.level;
    expect(dropped).toBeGreaterThanOrEqual(2);
    c.end();
    expect(c.start()).toBe(dropped); // slow interaction: keep the learned level
    feed(c, 8, 60);
    c.end();
    expect(c.start()).toBe(dropped - 1);
    feed(c, 8, 60);
    c.end();
    expect(c.start()).toBe(dropped - 2);
  });

  test("minLevel is respected", () => {
    const c = createQualityController({ minLevel: 1 });
    expect(c.start()).toBe(1);
    feed(c, 4, 100);
    c.end();
    expect(c.start()).toBe(1);
    expect(c.level).toBe(1);
  });
});
