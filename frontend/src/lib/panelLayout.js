// Movable panels (Preferences > Panels, off by default). Pure logic only: where
// each panel sits, per preset; which dock a drop lands on and where in it;
// snapping and keeping a floating card inside the window. The drag itself is
// components/Movable.jsx, the dock areas components/DockArea.jsx.
//
// The model (owner, 10 Nov: "docks + snapping floats"):
//   - four dock areas round the viewer (left, right, top, bottom). Panels in
//     one area stack along it (columns top to bottom, rows left to right) and
//     share its length by weight, with a divider between each pair; the
//     area's thickness is one size per side, dragged at its inner edge;
//   - floating cards, each with its own position and size, that snap to the
//     window, the viewer and each other as they move or resize;
//   - "home": where the panel has always been (the toolbar above the viewer,
//     the readout chip in its corner, layer settings on the right, a section
//     in the sidebar).
// The toolbar has its own lane next to the viewer rather than a share of a
// dock area: on the left or right it is a narrow strip of icons.
import { SECTION_IDS } from "@/lib/sections";

// A placement is { dock: "home" }, { dock: SIDE, order, weight } or
// { dock: "float", x, y, w?, h? } (px from the window's top-left; no w/h =
// the panel's own size).
export const PANEL_KINDS = ["inspector", "toolbar", "readout"];
export const isSectionKind = (k) => SECTION_IDS.includes(k);
const isKind = (k) => PANEL_KINDS.includes(k) || isSectionKind(k);
export const SIDES = ["left", "right", "top", "bottom"];
// Kept for the drop zones' order: the ones checked first win at corners.
export const DOCKS = SIDES;
export const HOME = { dock: "home" };
// The toolbar's home is above the viewer, so "top" is home for it.
const sidesFor = (kind) => (kind === "toolbar" ? ["left", "right", "bottom"] : SIDES);
export const canDock = (kind, side) => sidesFor(kind).includes(side) || (kind === "toolbar" && side === "top");

// Dock area thickness (px): the default, and the range a drag may set.
export const DOCK_SIZE = { left: 300, right: 320, top: 160, bottom: 200 };
export const DOCK_RANGE = { left: [160, 720], right: [160, 720], top: [64, 520], bottom: [64, 520] };
// A floating card is never smaller than this.
export const MIN_CARD = { w: 160, h: 64 };
const WEIGHT_RANGE = [0.05, 20];
const DOCKS_KEY = "_docks";

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** One placement as stored: anything unknown becomes "home". */
export function cleanPlacement(p, kind) {
  if (!p || typeof p !== "object") return HOME;
  const dock = p.dock === "below" ? "bottom" : p.dock; // "below" before 10 Nov
  if (SIDES.includes(dock)) {
    if (!kind || !canDock(kind, dock) || (kind === "toolbar" && dock === "top")) {
      return kind ? HOME : { dock, order: 0, weight: 1 };
    }
    return {
      dock,
      order: isNum(p.order) && p.order >= 0 ? Math.round(p.order) : 0,
      weight: isNum(p.weight) ? clamp(p.weight, ...WEIGHT_RANGE) : 1,
    };
  }
  if (dock === "float" && isNum(p.x) && isNum(p.y)) {
    const out = { dock: "float", x: Math.round(p.x), y: Math.round(p.y) };
    if (isNum(p.w) && p.w > 0) out.w = Math.round(Math.max(MIN_CARD.w, p.w));
    if (isNum(p.h) && p.h > 0) out.h = Math.round(Math.max(MIN_CARD.h, p.h));
    return out;
  }
  return HOME;
}

function cleanDocks(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const s of SIDES) if (isNum(raw[s])) out[s] = Math.round(clamp(raw[s], ...DOCK_RANGE[s]));
  return out;
}

/** `{ [presetId]: { [kind]: placement, _docks: { [side]: px } } }` as stored:
 *  unknown kinds and placements at home are dropped, so a layout nobody
 *  changed stores nothing. */
export function cleanLayouts(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [preset, kinds] of Object.entries(raw)) {
    if (!kinds || typeof kinds !== "object") continue;
    const layout = {};
    for (const k of Object.keys(kinds)) {
      if (k === DOCKS_KEY) {
        const d = cleanDocks(kinds[k]);
        if (Object.keys(d).length) layout[DOCKS_KEY] = d;
        continue;
      }
      if (!isKind(k)) continue;
      const p = cleanPlacement(kinds[k], k);
      if (p.dock !== "home") layout[k] = p;
    }
    if (Object.keys(layout).length) out[preset] = layout;
  }
  return out;
}

/** Where `kind` sits in `presetId`'s layout. */
export function placementOf(layouts, presetId, kind) {
  return cleanPlacement(layouts?.[presetId]?.[kind], kind);
}

/** The thickness of `side`'s dock area in `presetId`'s layout (px). */
export function dockSizeOf(layouts, presetId, side) {
  const v = layouts?.[presetId]?.[DOCKS_KEY]?.[side];
  return isNum(v) ? clamp(v, ...DOCK_RANGE[side]) : DOCK_SIZE[side];
}

/** The kinds docked on `side`, in order (the toolbar is not among them: it
 *  has its own lane). */
export function dockedOn(layouts, presetId, side) {
  const layout = layouts?.[presetId] || {};
  return Object.keys(layout)
    .filter((k) => k !== DOCKS_KEY && k !== "toolbar" && isKind(k))
    .map((k) => ({ kind: k, p: cleanPlacement(layout[k], k) }))
    .filter(({ p }) => p.dock === side)
    .sort((a, b) => a.p.order - b.p.order || (a.kind < b.kind ? -1 : 1))
    .map(({ kind, p }) => ({ kind, weight: p.weight }));
}

/** The next `layouts` after `action` (every action names its preset):
 *    { type: "dock", kind, dock, index? }  into a dock area, at `index` in its
 *                                          stack (default: the end)
 *    { type: "float", kind, x, y, w?, h? } as a floating card (also moves or
 *                                          resizes one)
 *    { type: "home", kind }                back where it started
 *    { type: "weights", side, weights }    { kind: weight } after a divider drag
 *    { type: "dockSize", side, size }      a dock area's thickness
 *    { type: "reset" }                     the whole preset's layout */
export function layoutReducer(layouts, action) {
  const cur = cleanLayouts(layouts);
  const { preset, kind } = action;
  if (typeof preset !== "string") return cur;
  const layout = { ...(cur[preset] || {}) };
  const done = () => cleanLayouts({ ...cur, [preset]: layout });

  if (action.type === "reset") {
    const { [preset]: _gone, ...rest } = cur;
    return rest;
  }
  if (action.type === "dockSize") {
    if (!SIDES.includes(action.side) || !isNum(action.size)) return cur;
    layout[DOCKS_KEY] = { ...(layout[DOCKS_KEY] || {}), [action.side]: action.size };
    return done();
  }
  if (action.type === "weights") {
    if (!SIDES.includes(action.side) || !action.weights) return cur;
    for (const [k, w] of Object.entries(action.weights)) {
      const p = cleanPlacement(layout[k], k);
      if (p.dock === action.side && isNum(w)) layout[k] = { ...p, weight: w };
    }
    return done();
  }
  if (!isKind(kind)) return cur;
  if (action.type === "dock") {
    if (!SIDES.includes(action.dock) || !canDock(kind, action.dock)) return cur;
    if (kind === "toolbar") {
      if (action.dock === "top") delete layout[kind];
      else layout[kind] = { dock: action.dock, order: 0, weight: 1 };
      return done();
    }
    const was = cleanPlacement(layout[kind], kind);
    const others = dockedOn(cur, preset, action.dock).filter((d) => d.kind !== kind);
    const at = isNum(action.index) ? clamp(Math.round(action.index), 0, others.length) : others.length;
    const stack = [...others.slice(0, at), { kind, weight: was.dock === action.dock ? was.weight : 1 }, ...others.slice(at)];
    stack.forEach((d, i) => { layout[d.kind] = { dock: action.dock, order: i, weight: d.weight }; });
    return done();
  }
  if (action.type === "float") {
    layout[kind] = { dock: "float", x: action.x, y: action.y, w: action.w, h: action.h };
    return done();
  }
  delete layout[kind];
  return done();
}

/** The four drop zones over the viewer rect {left, top, right, bottom}: a strip
 *  along each edge (left and right full height; top and bottom between them). */
export function dockZones(rect, strip = 96) {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  const s = Math.max(24, Math.min(strip, w / 3, h / 3));
  return {
    left: { left: rect.left, top: rect.top, right: rect.left + s, bottom: rect.bottom },
    right: { left: rect.right - s, top: rect.top, right: rect.right, bottom: rect.bottom },
    top: { left: rect.left + s, top: rect.top, right: rect.right - s, bottom: rect.top + s },
    bottom: { left: rect.left + s, top: rect.bottom - s, right: rect.right - s, bottom: rect.bottom },
  };
}

const inside = (x, y, r) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** Which dock a pointer at (x, y) is over, or null (= drop as a floating card):
 *  an edge strip of the viewer, or a dock area itself (`areas`: { side: rect }
 *  for the areas on screen). */
export function hitDock(x, y, rect, strip, areas = {}) {
  for (const d of SIDES) if (inside(x, y, areas[d])) return d;
  if (!rect) return null;
  const zones = dockZones(rect, strip);
  for (const d of SIDES) if (inside(x, y, zones[d])) return d;
  return null;
}

/** Where in a dock's stack a drop at (x, y) goes: `slots` are the panels on
 *  screen in that dock, in order, as rects. Columns (left, right) stack top to
 *  bottom, rows (top, bottom) left to right. Returns the index to insert at. */
export function dropIndex(side, slots, x, y) {
  const vertical = side === "left" || side === "right";
  const p = vertical ? y : x;
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i];
    const mid = vertical ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
    if (p < mid) return i;
  }
  return slots.length;
}

/** Two neighbours' weights after their divider moves `delta` px: `a` and `b`
 *  are { weight, px } (px = their size along the dock now). Each keeps at
 *  least `min` px; the pair's total weight is unchanged. */
export function splitWeights(a, b, delta, min = 48) {
  const total = a.px + b.px;
  if (!(total > 0)) return [a.weight, b.weight];
  const pa = clamp(a.px + delta, Math.min(min, total / 2), total - Math.min(min, total / 2));
  const w = a.weight + b.weight;
  return [(w * pa) / total, (w * (total - pa)) / total];
}

/** A floating card's top-left kept fully inside a window of `win` {w, h}. */
export function clampFloat(x, y, size, win, top = 0) {
  const maxX = Math.max(0, win.w - size.w);
  const maxY = Math.max(top, win.h - size.h);
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(top, y)) };
}

// The value in `lines` nearest to one of `edges` within `th`: { value, edge,
// line } (value = how far to shift so that edge sits on the line), or null.
function nearest(edges, lines, th) {
  let best = null;
  for (const [i, e] of edges.entries()) {
    for (const l of lines) {
      const d = Math.abs(l - e);
      if (d <= th && (!best || d < best.d)) best = { d, shift: l - e, edge: i, line: l };
    }
  }
  return best;
}

/** Snapping a card `r` {x, y, w, h} being moved: its edges and centre catch on
 *  the lines of `targets` (rects {left, top, right, bottom}: the window, the
 *  viewer, the other cards) within `th` px, so cards line up with each other
 *  and stack edge to edge. Returns { x, y, guides: { x?, y? } } (the lines it
 *  caught, to draw). */
export function snapMove(r, targets, th = 8) {
  const xs = []; const ys = [];
  for (const t of targets) { xs.push(t.left, t.right); ys.push(t.top, t.bottom); }
  const sx = nearest([r.x, r.x + r.w], xs, th);
  const sy = nearest([r.y, r.y + r.h], ys, th);
  return {
    x: r.x + (sx ? sx.shift : 0),
    y: r.y + (sy ? sy.shift : 0),
    guides: { ...(sx ? { x: sx.line } : {}), ...(sy ? { y: sy.line } : {}) },
  };
}

/** Snapping a card being resized from `edges` ("n", "s", "e", "w" in any
 *  combination): only the moving edges catch. `r` is the card as dragged;
 *  returns the snapped { x, y, w, h, guides }, never under MIN_CARD. */
export function snapResize(r, edges, targets, th = 8) {
  const xs = []; const ys = [];
  for (const t of targets) { xs.push(t.left, t.right); ys.push(t.top, t.bottom); }
  let { x, y, w, h } = r;
  const guides = {};
  if (edges.includes("e")) { const s = nearest([x + w], xs, th); if (s) { w += s.shift; guides.x = s.line; } }
  if (edges.includes("w")) { const s = nearest([x], xs, th); if (s) { x += s.shift; w -= s.shift; guides.x = s.line; } }
  if (edges.includes("s")) { const s = nearest([y + h], ys, th); if (s) { h += s.shift; guides.y = s.line; } }
  if (edges.includes("n")) { const s = nearest([y], ys, th); if (s) { y += s.shift; h -= s.shift; guides.y = s.line; } }
  if (w < MIN_CARD.w) { if (edges.includes("w")) x -= MIN_CARD.w - w; w = MIN_CARD.w; }
  if (h < MIN_CARD.h) { if (edges.includes("n")) y -= MIN_CARD.h - h; h = MIN_CARD.h; }
  return { x, y, w, h, guides };
}

/** Where a section dragged over the sidebar would land. `items` are the other
 *  visible sections { id, top, bottom } (any order); `y` the pointer. Returns
 *  { beforeId, lineY }: the section it goes in front of (null = at the end) and
 *  where to draw the insertion line. */
export function sectionDropTarget(items, y) {
  const rows = [...items].sort((a, b) => a.top - b.top);
  if (!rows.length) return { beforeId: null, lineY: y };
  for (const r of rows) {
    if (y < (r.top + r.bottom) / 2) return { beforeId: r.id, lineY: r.top };
  }
  return { beforeId: null, lineY: rows[rows.length - 1].bottom };
}

/** `order` (a full list of ids) with `id` moved in front of `beforeId`
 *  (null = last). Unknown ids leave it as it was. */
export function moveBefore(order, id, beforeId) {
  if (!order.includes(id) || id === beforeId) return order;
  const rest = order.filter((x) => x !== id);
  if (beforeId == null) return [...rest, id];
  const at = rest.indexOf(beforeId);
  if (at < 0) return order;
  rest.splice(at, 0, id);
  return rest;
}
