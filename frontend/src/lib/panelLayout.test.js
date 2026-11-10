import {
  cleanPlacement, cleanLayouts, placementOf, layoutReducer, dockZones, hitDock, clampFloat, PANEL_KINDS, sectionDropTarget, moveBefore,
  dockedOn, dockSizeOf, DOCK_SIZE, dropIndex, splitWeights, snapMove, snapResize,
} from "./panelLayout";

const rect = { left: 300, top: 40, right: 1100, bottom: 800 };

describe("placements", () => {
  test("unknown or broken placements are home", () => {
    expect(cleanPlacement(null, "inspector")).toEqual({ dock: "home" });
    expect(cleanPlacement({ dock: "up" }, "inspector")).toEqual({ dock: "home" });
    expect(cleanPlacement({ dock: "float", x: "a", y: 2 }, "inspector")).toEqual({ dock: "home" });
  });
  test("docks and floats survive, with order, weight and size", () => {
    expect(cleanPlacement({ dock: "left" }, "inspector")).toEqual({ dock: "left", order: 0, weight: 1 });
    expect(cleanPlacement({ dock: "top", order: 2, weight: 3 }, "readout")).toEqual({ dock: "top", order: 2, weight: 3 });
    expect(cleanPlacement({ dock: "float", x: 10.4, y: 20.6 }, "readout")).toEqual({ dock: "float", x: 10, y: 21 });
    expect(cleanPlacement({ dock: "float", x: 0, y: 0, w: 20, h: 900.2 }, "readout")).toEqual({ dock: "float", x: 0, y: 0, w: 160, h: 900 });
  });
  test("a layout saved before 10 Nov (dock 'below') still loads", () => {
    expect(cleanPlacement({ dock: "below" }, "inspector")).toEqual({ dock: "bottom", order: 0, weight: 1 });
    expect(cleanPlacement({ dock: "below" }, "toolbar")).toEqual({ dock: "bottom", order: 0, weight: 1 });
  });
  test("the toolbar's top dock is its home", () => {
    expect(cleanPlacement({ dock: "top" }, "toolbar")).toEqual({ dock: "home" });
  });
  test("cleanLayouts drops unknown kinds, home and empty presets, and keeps dock sizes", () => {
    expect(cleanLayouts({ a: { inspector: { dock: "home" }, nope: { dock: "left" } }, b: { toolbar: { dock: "bottom" } } }))
      .toEqual({ b: { toolbar: { dock: "bottom", order: 0, weight: 1 } } });
    expect(cleanLayouts({ a: { _docks: { left: 5000, up: 3 } } })).toEqual({ a: { _docks: { left: 720 } } });
    expect(cleanLayouts([])).toEqual({});
  });
});

describe("layoutReducer", () => {
  test("everything is home by default, in every preset", () => {
    for (const k of PANEL_KINDS) expect(placementOf({}, "reading", k)).toEqual({ dock: "home" });
  });
  test("dock, float and home are kept per preset", () => {
    let l = layoutReducer({}, { type: "dock", preset: "a", kind: "inspector", dock: "left" });
    l = layoutReducer(l, { type: "float", preset: "b", kind: "readout", x: 5, y: 9 });
    expect(placementOf(l, "a", "inspector")).toEqual({ dock: "left", order: 0, weight: 1 });
    expect(placementOf(l, "b", "inspector")).toEqual({ dock: "home" });
    expect(placementOf(l, "b", "readout")).toEqual({ dock: "float", x: 5, y: 9 });
    l = layoutReducer(l, { type: "home", preset: "a", kind: "inspector" });
    expect(l.a).toBeUndefined();
  });
  test("panels docked on one side stack in drop order, and a drop index inserts", () => {
    let l = layoutReducer({}, { type: "dock", preset: "a", kind: "inspector", dock: "left" });
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "readout", dock: "left" });
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "section-lesion", dock: "left", index: 0 });
    expect(dockedOn(l, "a", "left").map((d) => d.kind)).toEqual(["section-lesion", "inspector", "readout"]);
    // Moving one within its stack keeps the others in order.
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "readout", dock: "left", index: 1 });
    expect(dockedOn(l, "a", "left").map((d) => d.kind)).toEqual(["section-lesion", "readout", "inspector"]);
  });
  test("the toolbar has its own lane: it is never in a dock's stack", () => {
    let l = layoutReducer({}, { type: "dock", preset: "a", kind: "toolbar", dock: "left" });
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "readout", dock: "left" });
    expect(dockedOn(l, "a", "left").map((d) => d.kind)).toEqual(["readout"]);
    expect(placementOf(l, "a", "toolbar").dock).toBe("left");
    expect(layoutReducer(l, { type: "dock", preset: "a", kind: "toolbar", dock: "top" }).a.toolbar).toBeUndefined();
  });
  test("weights and dock sizes are stored per preset", () => {
    let l = layoutReducer({}, { type: "dock", preset: "a", kind: "inspector", dock: "right" });
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "readout", dock: "right" });
    l = layoutReducer(l, { type: "weights", preset: "a", side: "right", weights: { inspector: 3, readout: 0.5 } });
    expect(dockedOn(l, "a", "right")).toEqual([{ kind: "inspector", weight: 3 }, { kind: "readout", weight: 0.5 }]);
    l = layoutReducer(l, { type: "dockSize", preset: "a", side: "right", size: 410 });
    expect(dockSizeOf(l, "a", "right")).toBe(410);
    expect(dockSizeOf(l, "b", "right")).toBe(DOCK_SIZE.right);
  });
  test("a bad dock or kind changes nothing", () => {
    expect(layoutReducer({}, { type: "dock", preset: "a", kind: "inspector", dock: "up" })).toEqual({});
    expect(layoutReducer({}, { type: "dock", preset: "a", kind: "sections", dock: "left" })).toEqual({});
  });
  test("reset clears one preset only", () => {
    let l = layoutReducer({}, { type: "dock", preset: "a", kind: "toolbar", dock: "right" });
    l = layoutReducer(l, { type: "dock", preset: "b", kind: "toolbar", dock: "right" });
    expect(Object.keys(layoutReducer(l, { type: "reset", preset: "a" }))).toEqual(["b"]);
  });
});

describe("dock hit-testing", () => {
  test("edges hit left, right, top and bottom; the middle floats", () => {
    expect(hitDock(310, 400, rect)).toBe("left");
    expect(hitDock(1090, 400, rect)).toBe("right");
    expect(hitDock(700, 790, rect)).toBe("bottom");
    expect(hitDock(700, 50, rect)).toBe("top");
    expect(hitDock(700, 400, rect)).toBeNull();
    expect(hitDock(50, 400, rect)).toBeNull();
    expect(hitDock(700, 400, null)).toBeNull();
  });
  test("a dock area on screen is a target too", () => {
    expect(hitDock(50, 400, rect, 96, { left: { left: 0, top: 40, right: 280, bottom: 800 } })).toBe("left");
  });
  test("strips never exceed a third of a small viewer", () => {
    const z = dockZones({ left: 0, top: 0, right: 90, bottom: 90 }, 96);
    expect(z.left.right).toBe(30);
  });
  test("dropIndex: columns by y, rows by x", () => {
    const col = [{ left: 0, right: 200, top: 0, bottom: 100 }, { left: 0, right: 200, top: 100, bottom: 300 }];
    expect(dropIndex("left", col, 50, 20)).toBe(0);
    expect(dropIndex("left", col, 50, 150)).toBe(1);
    expect(dropIndex("left", col, 50, 290)).toBe(2);
    const row = [{ left: 0, right: 100, top: 0, bottom: 50 }];
    expect(dropIndex("bottom", row, 80, 10)).toBe(1);
  });
  test("splitWeights keeps the total and a minimum size", () => {
    const [a, b] = splitWeights({ weight: 1, px: 200 }, { weight: 1, px: 200 }, 100);
    expect(a + b).toBeCloseTo(2);
    expect(a / b).toBeCloseTo(3);
    const [c, d] = splitWeights({ weight: 1, px: 200 }, { weight: 1, px: 200 }, 1000, 48);
    expect(d / (c + d)).toBeCloseTo(48 / 400);
  });
});

describe("snapping", () => {
  const win = { left: 0, top: 40, right: 1200, bottom: 800 };
  const other = { left: 500, top: 100, right: 800, bottom: 300 };
  test("a card catches the window edge and another card's edge", () => {
    const r = snapMove({ x: 6, y: 305, w: 200, h: 100 }, [win, other]);
    expect(r.x).toBe(0);
    expect(r.y).toBe(300); // stacked under the other card
    expect(r.guides).toEqual({ x: 0, y: 300 });
  });
  test("its right edge catches another card's left edge", () => {
    expect(snapMove({ x: 296, y: 150, w: 200, h: 100 }, [other]).x).toBe(300);
  });
  test("nothing near: no snap", () => {
    const r = snapMove({ x: 300, y: 500, w: 100, h: 100 }, [other], 8);
    expect(r).toEqual({ x: 300, y: 500, guides: {} });
  });
  test("resizing snaps only the moving edge, never under the minimum", () => {
    const r = snapResize({ x: 100, y: 100, w: 395, h: 100 }, "e", [other]);
    expect(r).toMatchObject({ x: 100, w: 400, guides: { x: 500 } });
    const s = snapResize({ x: 100, y: 100, w: 20, h: 10 }, "nw", []);
    expect(s).toMatchObject({ w: 160, h: 64, x: -40, y: 46 });
  });
});

describe("clampFloat", () => {
  test("keeps the card inside the window and under the title bar", () => {
    expect(clampFloat(-20, -5, { w: 300, h: 200 }, { w: 1000, h: 700 }, 40)).toEqual({ x: 0, y: 40 });
    expect(clampFloat(900, 650, { w: 300, h: 200 }, { w: 1000, h: 700 }, 40)).toEqual({ x: 700, y: 500 });
  });
  test("a card larger than the window sits at the origin", () => {
    expect(clampFloat(50, 50, { w: 2000, h: 2000 }, { w: 1000, h: 700 }, 40)).toEqual({ x: 0, y: 40 });
  });
});

describe("sidebar sections", () => {
  test("a section floats, docks beside the viewer, and comes home", () => {
    let l = layoutReducer({}, { type: "float", preset: "a", kind: "section-lesion", x: 40, y: 60 });
    expect(placementOf(l, "a", "section-lesion")).toEqual({ dock: "float", x: 40, y: 60 });
    l = layoutReducer(l, { type: "dock", preset: "a", kind: "section-lesion", dock: "left" });
    expect(placementOf(l, "a", "section-lesion")).toEqual({ dock: "left", order: 0, weight: 1 });
    l = layoutReducer(l, { type: "home", preset: "a", kind: "section-lesion" });
    expect(l).toEqual({});
    expect(cleanLayouts({ a: { "section-nope": { dock: "float", x: 1, y: 1 } } })).toEqual({});
  });
  test("dropping on the sidebar lands before the first section whose middle is below the pointer", () => {
    const items = [{ id: "b", top: 100, bottom: 140 }, { id: "a", top: 40, bottom: 80 }, { id: "c", top: 160, bottom: 200 }];
    expect(sectionDropTarget(items, 30)).toEqual({ beforeId: "a", lineY: 40 });
    expect(sectionDropTarget(items, 95)).toEqual({ beforeId: "b", lineY: 100 });
    expect(sectionDropTarget(items, 150)).toEqual({ beforeId: "c", lineY: 160 });
    expect(sectionDropTarget(items, 300)).toEqual({ beforeId: null, lineY: 200 });
    expect(sectionDropTarget([], 50)).toEqual({ beforeId: null, lineY: 50 });
  });
  test("moveBefore reorders and leaves bad input alone", () => {
    const o = ["a", "b", "c", "d"];
    expect(moveBefore(o, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveBefore(o, "a", null)).toEqual(["b", "c", "d", "a"]);
    expect(moveBefore(o, "b", "b")).toBe(o);
    expect(moveBefore(o, "x", "a")).toBe(o);
    expect(moveBefore(o, "a", "x")).toBe(o);
  });
});
