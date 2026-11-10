import { createRightClickGate } from "./rightClickGate";

describe("right-click menu gate", () => {
  test("Windows order: a still click opens on contextmenu", () => {
    const g = createRightClickGate();
    g.down(100, 100);
    expect(g.up(101, 100)).toBe(false);
    expect(g.contextmenu(101, 100)).toBe("open");
  });

  test("Windows order: a drag opens nothing", () => {
    const g = createRightClickGate();
    g.down(100, 100);
    expect(g.up(100, 160)).toBe(false);
    expect(g.contextmenu(100, 160)).toBe("skip");
  });

  test("macOS order: contextmenu on press is held, a drag then opens nothing", () => {
    // The bug: the menu opened here, at the start of the drag.
    const g = createRightClickGate();
    g.down(100, 100);
    expect(g.contextmenu(100, 100)).toBe("hold");
    expect(g.up(100, 160)).toBe(false);
  });

  test("macOS order: a still click opens on release", () => {
    const g = createRightClickGate();
    g.down(100, 100);
    expect(g.contextmenu(100, 100)).toBe("hold");
    expect(g.up(102, 101)).toBe(true);
  });

  test("a menu request with no right press (Ctrl+click, menu key) opens", () => {
    const g = createRightClickGate();
    expect(g.contextmenu(10, 10)).toBe("open");
  });

  test("each press is decided once", () => {
    const g = createRightClickGate();
    g.down(0, 0);
    g.contextmenu(0, 0);
    expect(g.up(0, 0)).toBe(true);
    expect(g.up(0, 0)).toBe(false);
  });
});
