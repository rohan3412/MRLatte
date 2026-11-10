import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Undo2 } from "lucide-react";
import { usePreference } from "@/lib/preferences";
import {
  DOCK_RANGE, HOME, SIDES, canDock, clampFloat, dockSizeOf, dockZones, dockedOn, dropIndex, hitDock, layoutReducer,
  placementOf, snapMove, snapResize, splitWeights,
} from "@/lib/panelLayout";

// Movable panels (Preferences ▸ Sidebar ▸ Panels, off by default; the model is
// lib/panelLayout.js). A panel has a grip; dragging it shows the dock targets
// on the viewer's four edges. Dropped on one (or on a dock area already on
// screen, at the place the line shows) it docks there, stacked with the
// panels already in that area; dropped anywhere else it floats as a card
// that moves by its header, resizes from its edges and corners, and snaps to
// the window, the viewer, the dock areas and the other cards. Double-click a
// grip or a card's header to put the panel back home. Esc while dragging
// cancels. A panel's React content is the same everywhere: only where it is
// portalled changes. Where each panel sits is saved per preset.

// Dock areas and the toolbar's lanes register their elements here, and the
// panels say which of them are docked (so an area with nothing in it takes no
// room). Without a provider (tests, a panel outside the dashboard) nothing docks.
const DockContext = createContext(null);

export function DockProvider({ children }) {
  const [slots, setSlots] = useState({});
  const [present, setPresentState] = useState({});
  const setSlot = useCallback((key, el) => setSlots((s) => (s[key] === el ? s : { ...s, [key]: el })), []);
  const setPresent = useCallback((key, on) => setPresentState((p) => (!!p[key] === !!on ? p : { ...p, [key]: !!on })), []);
  const value = useMemo(() => ({ slots, setSlot, present, setPresent }), [slots, present, setSlot, setPresent]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

/** The element `kind` is portalled into while docked (`on`), or null. Also
 *  tells its dock area it is there. */
export function useDockSlot(kind, on) {
  const ctx = useContext(DockContext);
  const setPresent = ctx?.setPresent;
  useEffect(() => {
    if (!setPresent) return undefined;
    setPresent(kind, !!on);
    return () => setPresent(kind, false);
  }, [setPresent, kind, on]);
  return on ? ctx?.slots?.[kind] || null : null;
}

const ALLOW_PREF = { inspector: "movableInspector", toolbar: "movableToolbar", readout: "movableReadout" };
const SIDE_LABEL = { left: "left of the viewer", right: "right of the viewer", top: "above the viewer", bottom: "below the viewer" };
// Panels that keep their own size in a dock area instead of sharing its length.
const NATURAL = new Set(["readout"]);

const viewerRect = () => document.querySelector('[data-testid="viewer-main"]')?.getBoundingClientRect() || null;
const areaRects = () => Object.fromEntries(
  [...document.querySelectorAll("[data-dock-area]")].map((el) => [el.dataset.dockArea, el.getBoundingClientRect()]),
);
const slotRects = (side, except) => [...document.querySelectorAll(`[data-dock-area="${side}"] [data-dock-slot]`)]
  .filter((el) => el.dataset.dockSlot !== except)
  .map((el) => el.getBoundingClientRect());
// Where the pointer sits on a floating card's header when it is dropped.
const GRIP_DX = 16;
const GRIP_DY = 14;
// A press that moves less than this is a click, not a drag (it moves nothing).
const DRAG_SLOP = 4;
// A floating card moved over the viewer docks only in a thin strip at its edge,
// so a card can still float close to an edge.
const CARD_DOCK_STRIP = 40;
const windowSize = () => ({ w: window.innerWidth, h: window.innerHeight });
// Below the title bar when there is one (the desktop app's own, 40px).
const topEdge = () => (document.querySelector('[data-testid="app-titlebar"]') ? 40 : 0);

/** The top-left of a card dropped with its header grip under `p` {x, y}. */
export const floatAt = (p, size) => clampFloat(p.x - GRIP_DX, p.y - GRIP_DY, size, windowSize(), topEdge());

/** Where `kind` sits (this preset) and how to change it. `prefKey` is the
 *  per-kind switch under Preferences ▸ Panels. */
export function usePlacement(kind, prefKey) {
  const [movable] = usePreference("movablePanels");
  const [kindOn] = usePreference(prefKey);
  const [layouts, setLayouts] = usePreference("panelLayouts");
  const [activePreset] = usePreference("activePreset");
  const preset = activePreset || "default";
  const allowed = !!(movable && kindOn);
  const placement = allowed ? placementOf(layouts, preset, kind) : HOME;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const dispatch = useCallback((action) => {
    setLayouts(layoutReducer(layoutsRef.current, { preset, kind, ...action }));
  }, [preset, kind, setLayouts]);
  return { allowed, placement, dispatch };
}

/** What a pointer at (x, y) would dock `kind` into: { type: "dock", dock,
 *  index, line } or null. `strip`: how deep the viewer's edge targets are. */
export function dockTargetAt(kind, x, y, strip) {
  const areas = areaRects();
  const dock = hitDock(x, y, viewerRect(), strip, areas);
  if (!dock || !canDock(kind, dock)) return null;
  if (kind === "toolbar") return { type: "dock", dock };
  const slots = slotRects(dock, kind);
  const index = dropIndex(dock, slots, x, y);
  const area = areas[dock];
  let line = null;
  if (area && slots.length) {
    const vertical = dock === "left" || dock === "right";
    const at = index < slots.length ? (vertical ? slots[index].top : slots[index].left)
      : (vertical ? slots[slots.length - 1].bottom : slots[slots.length - 1].right);
    line = vertical ? { left: area.left, top: at - 1, width: area.width, height: 3 }
      : { left: at - 1, top: area.top, width: 3, height: area.height };
  }
  return { type: "dock", dock, index, line };
}

/**
 * Dragging a panel by its grip. `extraTarget(x, y)` may claim the pointer
 * first (a section over the sidebar: reorder); otherwise the dock targets are
 * checked, and nothing means it floats. `onDrop(target, { x, y })` acts on
 * release. Returns the grip's pointerdown handler and the overlay to render
 * while dragging. The window listeners are added in the same event as the
 * pointerdown, so a quick drag can't outrun them. Esc cancels.
 */
export function useGripDrag({ title, kind, extraTarget, onDrop }) {
  const [drag, setDrag] = useState(null); // { x, y, target }
  const latest = useRef({});
  latest.current = { extraTarget, onDrop };
  const targetAt = (x, y) => latest.current.extraTarget?.(x, y) || dockTargetAt(kind, x, y);
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);
  const onGripDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      stop.current = null;
      setDrag(null);
    };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_SLOP) return;
      moved = true;
      setDrag({ x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY) });
    };
    const up = (ev) => {
      const target = targetAt(ev.clientX, ev.clientY);
      end();
      if (moved) latest.current.onDrop(target, { x: ev.clientX, y: ev.clientY });
    };
    const cancel = () => end();
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); end(); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    stop.current = end;
  };
  const overlay = drag && createPortal(<DragOverlay drag={drag} title={title} kind={kind} />, document.body);
  return { onGripDown, overlay, dragging: !!drag };
}

/** The usual drop: into a dock, or floating where it was let go. */
export function dropPanel(dispatch, target, p, size) {
  if (target?.type === "dock") { dispatch({ type: "dock", dock: target.dock, index: target.index }); return; }
  const pos = floatAt(p, { w: size?.w || 320, h: size?.h || 240 });
  dispatch({ type: "float", x: pos.x, y: pos.y });
}

export function GripButton({ title, kind, onPointerDown, onDoubleClick, hint, className = "h-7 w-7" }) {
  return (
    <button type="button" className={`icon-btn panel-grip flex-shrink-0 ${className}`} onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      aria-label={`Move ${title}. Drag to a highlighted edge to dock it, anywhere else to float it`}
      title={hint ? `Move ${title} (${hint})` : `Move ${title}`} data-testid={`panel-grip-${kind}`}>
      <GripVertical size={14} />
    </button>
  );
}

/**
 * `children({ grip, floating, docked })` renders the panel: `grip` is the drag
 * handle to place in its header (null when the panel can't move), `floating`
 * says the panel is in a card, `docked` is the side it is docked on.
 * `size`: the floating card's first { w, h } (px; h omitted = as tall as its
 * content); the card can then be resized.
 */
export function Movable({ kind, title, size, children }) {
  const ctx = useContext(DockContext);
  const { allowed, placement, dispatch } = usePlacement(kind, ALLOW_PREF[kind]);
  const side = SIDES.includes(placement.dock) ? placement.dock : null;
  const lane = kind === "toolbar";
  const slot = useDockSlot(kind, !!side && !lane);
  const laneSlot = lane && side ? ctx?.slots?.[`toolbar@${side}`] || null : null;

  const { onGripDown, overlay } = useGripDrag({
    title, kind, onDrop: (target, p) => dropPanel(dispatch, target, p, size),
  });

  // Double-click: a moved panel goes back home; one at home floats near its grip.
  const atHome = placement.dock === "home";
  const onGripDouble = (e) => {
    if (!atHome) { dispatch({ type: "home" }); return; }
    const pos = floatAt({ x: e.clientX, y: e.clientY }, { w: size?.w || 320, h: size?.h || 240 });
    dispatch({ type: "float", x: pos.x, y: pos.y });
  };
  const grip = allowed ? (
    <GripButton title={title} kind={kind} onPointerDown={onGripDown} onDoubleClick={onGripDouble}
      hint={atHome ? "double-click to float it" : "double-click to put it back"} />
  ) : null;

  if (placement.dock === "float") {
    return (
      <>
        <FloatingCard kind={kind} title={title} size={size} placement={placement} dispatch={dispatch}
          chrome={kind === "readout" ? "bare" : "header"}>
          {children({ grip: null, floating: true })}
        </FloatingCard>
        {overlay}
      </>
    );
  }
  const into = lane ? laneSlot : slot;
  if (side) {
    // Until its area or lane is on screen (one render), nothing shows.
    return (
      <>
        {into && createPortal(
          <div data-movable={kind} data-docked={side} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children({ grip, floating: false, docked: side })}
          </div>, into)}
        {overlay}
      </>
    );
  }
  return (
    <>
      <div data-movable={kind} className="contents">{children({ grip, floating: false })}</div>
      {overlay}
    </>
  );
}

/** A panel docked without a header of its own (a sidebar section): a slim
 *  header to drag it by, with its name and a button to put it back. */
export function DockedFrame({ kind, title, icon: Icon, onGripDown, onHome, children }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`docked-${kind}`}>
      <div className="panel-grip flex h-8 flex-shrink-0 cursor-grab items-center gap-2 border-b border-border pl-2.5 pr-1"
        onPointerDown={(e) => { if (!e.target.closest("button")) onGripDown(e); }}
        onDoubleClick={(e) => { if (!e.target.closest("button")) onHome(); }}
        title={`Move ${title} (double-click to put it back)`}>
        {Icon && <Icon size={14} className="flex-shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{title}</span>
        <button type="button" className="icon-btn h-6 w-6" onClick={onHome}
          aria-label={`Put ${title} back`} title="Put back" data-testid={`dock-back-${kind}`}>
          <Undo2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">{children}</div>
    </div>
  );
}

/**
 * A dock area on one side of the viewer: the panels docked there, stacked
 * (columns top to bottom, rows left to right) and sharing its length by
 * weight, with a divider between each pair, and a handle on its inner edge
 * that sets its thickness. Renders nothing while no panel is docked there.
 */
export function DockArea({ side }) {
  const ctx = useContext(DockContext);
  const [layouts, setLayouts] = usePreference("panelLayouts");
  const [movable] = usePreference("movablePanels");
  const [activePreset] = usePreference("activePreset");
  const preset = activePreset || "default";
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const [liveSize, setLiveSize] = useState(null);
  const [liveWeights, setLiveWeights] = useState(null);
  const refs = useRef({});
  const setSlot = ctx?.setSlot;
  const slotRef = (k) => {
    if (!refs.current[k]) refs.current[k] = (el) => setSlot?.(k, el);
    return refs.current[k];
  };

  const stack = movable && ctx ? dockedOn(layouts, preset, side).filter((d) => ctx.present[d.kind]) : [];
  if (!stack.length) return null;

  const vertical = side === "left" || side === "right";
  const size = liveSize ?? dockSizeOf(layouts, preset, side);
  const weightOf = (d) => liveWeights?.[d.kind] ?? d.weight;
  const commit = (action) => setLayouts(layoutReducer(layoutsRef.current, { preset, ...action }));

  // Drag the inner edge: the area's thickness.
  const onEdgeDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = vertical ? e.clientX : e.clientY;
    const from = size;
    const sign = side === "left" || side === "top" ? 1 : -1;
    const [lo, hi] = DOCK_RANGE[side];
    let last = from;
    const move = (ev) => {
      last = Math.min(hi, Math.max(lo, from + sign * ((vertical ? ev.clientX : ev.clientY) - start)));
      setLiveSize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit({ type: "dockSize", side, size: last });
      setLiveSize(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag a divider: how the two panels either side of it share their room.
  const onDividerDown = (i) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const a = stack[i - 1];
    const b = stack[i];
    const ea = ctx.slots[a.kind];
    const eb = ctx.slots[b.kind];
    if (!ea || !eb) return;
    const pa = vertical ? ea.offsetHeight : ea.offsetWidth;
    const pb = vertical ? eb.offsetHeight : eb.offsetWidth;
    const start = vertical ? e.clientY : e.clientX;
    let last = null;
    const move = (ev) => {
      const [wa, wb] = splitWeights({ weight: weightOf(a), px: pa }, { weight: weightOf(b), px: pb },
        (vertical ? ev.clientY : ev.clientX) - start);
      last = { [a.kind]: wa, [b.kind]: wb };
      setLiveWeights(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (last) commit({ type: "weights", side, weights: last });
      setLiveWeights(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const edge = { left: "border-r", right: "border-l", top: "border-b", bottom: "border-t" }[side];
  const handle = {
    left: "right-0 top-0 h-full w-1.5 translate-x-1/2 cursor-col-resize",
    right: "left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize",
    top: "bottom-0 left-0 w-full h-1.5 translate-y-1/2 cursor-row-resize",
    bottom: "top-0 left-0 w-full h-1.5 -translate-y-1/2 cursor-row-resize",
  }[side];
  return (
    <div data-dock-area={side} data-testid={`dock-${side}`}
      className={`dock-area relative flex ${vertical ? "flex-col" : "flex-row"} ${edge} border-border bg-panel`}
      // Its size, but it gives way (down to a minimum) before the viewer does
      // in a small window.
      style={vertical ? { flex: `0 1 ${size}px`, minWidth: Math.min(size, 160) }
        : { flex: `0 1 ${size}px`, minHeight: Math.min(size, 64) }}>
      {stack.map((d, i) => {
        const natural = NATURAL.has(d.kind);
        const resizable = i > 0 && !natural && !NATURAL.has(stack[i - 1].kind);
        return (
          <React.Fragment key={d.kind}>
            {i > 0 && (resizable ? (
              <div role="separator" aria-orientation={vertical ? "horizontal" : "vertical"}
                className={`dock-divider flex-shrink-0 ${vertical ? "h-[5px] cursor-row-resize" : "w-[5px] cursor-col-resize"}`}
                onPointerDown={onDividerDown(i)} data-testid={`dock-divider-${side}-${i}`} />
            ) : <div className={`flex-shrink-0 bg-border ${vertical ? "h-px" : "w-px"}`} />)}
            <div ref={slotRef(d.kind)} data-dock-slot={d.kind}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              style={natural ? { flex: "0 0 auto" } : { flex: `${weightOf(d)} 1 0`, [vertical ? "minHeight" : "minWidth"]: 48 }} />
          </React.Fragment>
        );
      })}
      <div className={`dock-edge absolute z-10 ${handle}`} onPointerDown={onEdgeDown}
        aria-label={`Resize the panels ${SIDE_LABEL[side]}`} data-testid={`dock-edge-${side}`} />
    </div>
  );
}

/** Where the toolbar goes when docked on `side` (left, right or bottom): its
 *  own lane, between the viewer and that side's dock area. */
export function DockLane({ side }) {
  const setSlot = useContext(DockContext)?.setSlot;
  const ref = useCallback((el) => setSlot?.(`toolbar@${side}`, el), [setSlot, side]);
  return <div ref={ref} className="flex flex-shrink-0 empty:hidden" data-testid={`toolbar-lane-${side}`} />;
}

// The dock targets over the viewer's edges, the insertion line in a dock area,
// and a small label that follows the pointer.
function DragOverlay({ drag, title, kind, strip }) {
  const rect = viewerRect();
  const zones = rect ? dockZones(rect, strip) : null;
  const t = drag.target;
  return (
    <>
      {zones && Object.entries(zones).filter(([dock]) => canDock(kind, dock)).map(([dock, z]) => (
        <div key={dock} className="dock-target" data-hot={t?.dock === dock ? "" : undefined}
          data-testid={`dock-target-${dock}`} aria-label={`Dock ${SIDE_LABEL[dock]}`}
          style={{ left: z.left, top: z.top, width: z.right - z.left, height: z.bottom - z.top }} />
      ))}
      {t?.line && (
        <div className="pointer-events-none fixed z-[91] rounded-full bg-foreground/80" data-testid="dock-line"
          style={t.line} />
      )}
      {t?.type === "reorder" && (
        <div className="pointer-events-none fixed z-[91] h-[3px] rounded-full bg-foreground/80" data-testid="reorder-line"
          style={{ left: t.left, width: t.width, top: t.lineY - 1 }} />
      )}
      <div className="frosted pointer-events-none fixed z-[91] rounded-md px-2.5 py-1 text-[12px] text-foreground"
        style={{ left: drag.x + 12, top: drag.y + 12 }}>
        {title}{t?.dock ? ` · ${kind === "toolbar" && t.dock === "top" ? "back above the viewer" : SIDE_LABEL[t.dock]}` : t?.type === "reorder" ? " · move here" : ""}
      </div>
    </>
  );
}

// What a moving or resizing card catches on: the window (under the title
// bar), the viewer, the sidebar, the dock areas and the other floating cards.
function snapTargets(self) {
  const out = [{ left: 0, top: topEdge(), right: window.innerWidth, bottom: window.innerHeight }];
  const v = viewerRect();
  if (v) out.push(v);
  const side = document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect();
  if (side && side.width > 0) out.push(side);
  for (const el of document.querySelectorAll("[data-dock-area], [data-floating]")) {
    if (el !== self) out.push(el.getBoundingClientRect());
  }
  return out;
}

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const EDGE_CLASS = {
  n: "left-2 right-2 -top-1 h-2 cursor-ns-resize", s: "left-2 right-2 -bottom-1 h-2 cursor-ns-resize",
  e: "top-2 bottom-2 -right-1 w-2 cursor-ew-resize", w: "top-2 bottom-2 -left-1 w-2 cursor-ew-resize",
  ne: "-right-1 -top-1 h-3 w-3 cursor-nesw-resize", sw: "-bottom-1 -left-1 h-3 w-3 cursor-nesw-resize",
  nw: "-left-1 -top-1 h-3 w-3 cursor-nwse-resize", se: "-bottom-1 -right-1 h-3 w-3 cursor-nwse-resize",
};

/**
 * A floating panel: a frosted card in a fixed layer over the window. It moves
 * by its header (`chrome="header"`) or by any part of it (`chrome="bare"`: no
 * header at all, for the readout), resizes from its edges and corners, snaps
 * as it goes (guides show what it caught), and slides into its place on
 * release. Moved over a viewer edge it docks there. Kept inside the window as
 * that resizes. Its layer (z 45) is above the app but under dialogs and menus
 * (z 50), so a menu it opens shows on top.
 */
export function FloatingCard({ kind, title, size, placement, dispatch, chrome = "header", children }) {
  const cardRef = useRef(null);
  const fromPlacement = () => ({ x: placement.x, y: placement.y, w: placement.w ?? size?.w, h: placement.h ?? size?.h });
  const [rect, setRect] = useState(fromPlacement);
  const [busy, setBusy] = useState(false);
  const [guides, setGuides] = useState(null);
  const [hot, setHot] = useState(null); // { x, y, target } while moving over a dock target
  const [box, setBox] = useState({ w: size?.w || 320, h: size?.h || 200 });
  const [, bump] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRect(fromPlacement()); }, [placement.x, placement.y, placement.w, placement.h]);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // The card's real size (it may be as tall as its content).
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = busy ? rect : { ...rect, ...clampFloat(rect.x, rect.y, box, windowSize(), topEdge()) };

  // One pointer interaction (move or resize) at a time; Esc puts it back.
  const interact = (e, onMove, onUp) => {
    e.preventDefault();
    const before = rect;
    setBusy(true);
    let last = null;
    const move = (ev) => { last = onMove(ev); };
    const finish = (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      setBusy(false);
      setGuides(null);
      setHot(null);
      if (commit && last) onUp(last); else setRect(before);
    };
    const up = () => finish(true);
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); finish(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  };

  const onMoveDown = (e) => {
    if (e.button !== 0 || e.target.closest("button, input, select, textarea, [data-resize]")) return;
    const dx = e.clientX - shown.x;
    const dy = e.clientY - shown.y;
    const x0 = e.clientX;
    const y0 = e.clientY;
    interact(e, (ev) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_SLOP) return null;
      const s = snapMove({ x: ev.clientX - dx, y: ev.clientY - dy, w: box.w, h: box.h }, snapTargets(cardRef.current));
      const c = clampFloat(s.x, s.y, box, windowSize(), topEdge());
      setRect((r) => ({ ...r, ...c }));
      setGuides(s.guides);
      const target = dockTargetAt(kind, ev.clientX, ev.clientY, CARD_DOCK_STRIP);
      setHot(target ? { x: ev.clientX, y: ev.clientY, target } : null);
      return { ...c, target };
    }, (last) => {
      if (last.target) dispatch({ type: "dock", dock: last.target.dock, index: last.target.index });
      else dispatch({ type: "float", x: last.x, y: last.y, w: rect.w, h: rect.h });
    });
  };

  const onResizeDown = (edges) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: shown.x, y: shown.y, w: box.w, h: box.h };
    const x0 = e.clientX;
    const y0 = e.clientY;
    interact(e, (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const raw = { ...start };
      if (edges.includes("e")) raw.w = start.w + dx;
      if (edges.includes("w")) { raw.x = start.x + dx; raw.w = start.w - dx; }
      if (edges.includes("s")) raw.h = start.h + dy;
      if (edges.includes("n")) { raw.y = start.y + dy; raw.h = start.h - dy; }
      const s = snapResize(raw, edges, snapTargets(cardRef.current));
      // Only the dragged axis is fixed; the other keeps following the content.
      const horiz = edges.includes("e") || edges.includes("w");
      const vert = edges.includes("n") || edges.includes("s");
      const next = { x: s.x, y: Math.max(topEdge(), s.y), w: horiz ? s.w : rect.w, h: vert ? s.h : rect.h };
      setRect(next);
      setGuides(s.guides);
      return next;
    }, (last) => dispatch({ type: "float", ...last }));
  };

  const putBack = (
    <button type="button" className="icon-btn h-6 w-6 flex-shrink-0" onClick={() => dispatch({ type: "home" })}
      aria-label={`Put ${title} back`} title="Put back" data-testid={`dock-back-${kind}`}>
      <Undo2 size={13} />
    </button>
  );
  const bare = chrome === "bare";
  return (<>
    {hot && createPortal(<DragOverlay drag={hot} title={title} kind={kind} strip={CARD_DOCK_STRIP} />, document.body)}
    {guides && createPortal(
      <>
        {guides.x != null && <div className="snap-guide fixed bottom-0 top-0 z-[92] w-px" style={{ left: guides.x }} />}
        {guides.y != null && <div className="snap-guide fixed left-0 right-0 z-[92] h-px" style={{ top: guides.y }} />}
      </>, document.body)}
    {createPortal(
      <div className="pointer-events-none fixed inset-0 z-[45]" data-testid="floating-layer">
        <div ref={cardRef} data-movable={kind} data-floating="" data-busy={busy ? "" : undefined} role="group" aria-label={title}
          className={`floating-card frosted group/card pointer-events-auto absolute flex max-h-[calc(100vh-48px)] max-w-[96vw] flex-col rounded-[10px] ${bare ? "cursor-grab" : ""}`}
          style={{ left: shown.x, top: shown.y, width: rect.w, height: rect.h }}
          onPointerDown={bare ? onMoveDown : undefined}
          onDoubleClick={bare ? () => dispatch({ type: "home" }) : undefined}
          data-testid={`floating-${kind}`}>
          {bare ? (
            <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
              {putBack}
            </div>
          ) : (
            <div className="panel-grip flex h-7 flex-shrink-0 cursor-grab items-center gap-1 border-b border-border pl-2.5 pr-1"
              onPointerDown={onMoveDown} onDoubleClick={(e) => { if (!e.target.closest("button")) dispatch({ type: "home" }); }}
              title={`Move ${title} (double-click to put it back)`}>
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-muted-foreground">{title}</span>
              {putBack}
            </div>
          )}
          <div className={`flex min-h-0 flex-1 flex-col overflow-auto thin-scroll rounded-[10px] ${bare ? "pointer-events-none" : ""}`}>{children}</div>
          {EDGES.map((ed) => (
            <div key={ed} data-resize={ed} className={`absolute ${EDGE_CLASS[ed]}`} onPointerDown={onResizeDown(ed)} />
          ))}
        </div>
      </div>,
      document.body,
    )}
  </>);
}

export default Movable;
