import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, RefreshCw } from "lucide-react";
import { useCapability, useModules, useModulesFor } from "@/hooks/use-modules";
import { usePreference } from "@/lib/preferences";
import { effectsOn } from "@/lib/viewer/effects";
import { SECTION_IDS, effectiveOrder } from "@/lib/sections";
import { SIDES, moveBefore, sectionDropTarget } from "@/lib/panelLayout";
import { DockedFrame, FloatingCard, GripButton, dropPanel, floatAt, useDockSlot, useGripDrag, usePlacement } from "@/components/Movable";
import { moduleSize, moduleStatus, toInstallFor } from "@/lib/modules";
import { retryFailedLazyLoads } from "@/lib/lazyWithRetry";

// Error boundary that catches chunk-load failures (and any other render error)
// inside a SidebarSection. Shows a minimal inline fallback with a Refresh
// button so the user can recover without a full page reload.
class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }
  static getDerivedStateFromError(error) {
    const isChunkError =
      error?.name === "ChunkLoadError" ||
      /loading chunk/i.test(error?.message ?? "") ||
      /loading css chunk/i.test(error?.message ?? "");
    return { hasError: true, isChunkError };
  }
  reset() {
    // A panel whose code failed to download gets a fresh attempt (React would
    // otherwise re-throw the remembered failure: lib/lazyWithRetry.js).
    retryFailedLazyLoads();
    this.setState({ hasError: false, isChunkError: false });
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="space-y-2 py-2">
        <p className="cap text-destructive">
          {this.state.isChunkError
            ? "Failed to load panel (network error)"
            : "Something went wrong"}
        </p>
        <button
          onClick={() => this.reset()}
          className="flex items-center gap-1.5 cap text-subtle hover:text-foreground transition-colors"
        >
          <RefreshCw size={10} /> Try again
        </button>
      </div>
    );
  }
}


// Item 105: registry that lets the sidebar header's "toggle all" button see how
// many sections are currently open and drive them all at once, WITHOUT hoisting
// eleven separate open/closed states into Dashboard (most sections are
// uncontrolled via defaultOpen, and several live in their own section files).
// Every SidebarSection rendered under a provider self-registers here; sections
// rendered outside one (tests, storybook) simply see a null context and behave
// exactly as before.
const SidebarSectionsContext = React.createContext(null);

/**
 * Owns the "toggle all sections" registry. Returns:
 *   ctx       — pass to <SidebarSectionsContext.Provider value={ctx}>
 *   openCount — how many registered sections are currently open
 *   setAll    — setAll(true|false) opens/closes every registered section
 *   sections  — every registered section in sidebar order, with what the
 *               collapsed sidebar's icon rail shows for it: { id, testId,
 *               title, icon, badge, unavailable, gatePill, isOpen, setOpen }
 */
export function useSidebarSectionsController() {
  // id -> { isOpen, setOpen }. A ref (not state) because sections mutate their
  // own entry on every open/close and we only want ONE re-render per change,
  // driven by the openCount below.
  const entriesRef = React.useRef(new Map());
  const [openCount, setOpenCount] = React.useState(0);
  // Bumped when a section's rail metadata (title, badge, gate) changes.
  const [metaVersion, setMetaVersion] = React.useState(0);

  const recount = React.useCallback(() => {
    let n = 0;
    entriesRef.current.forEach((e) => { if (e.isOpen) n += 1; });
    setOpenCount(n);
  }, []);

  const register = React.useCallback((id, entry) => {
    entriesRef.current.set(id, entry);
    recount();
    return () => { entriesRef.current.delete(id); recount(); };
  }, [recount]);

  const report = React.useCallback((id, isOpen) => {
    const e = entriesRef.current.get(id);
    if (!e || e.isOpen === isOpen) return;
    e.isOpen = isOpen;
    recount();
  }, [recount]);

  const describe = React.useCallback((id, meta) => {
    const e = entriesRef.current.get(id);
    if (!e) return;
    const old = e.meta || {};
    if (Object.keys(meta).every((k) => old[k] === meta[k])) return;
    e.meta = meta;
    setMetaVersion((v) => v + 1);
  }, []);

  const setAll = React.useCallback((open) => {
    entriesRef.current.forEach((e) => {
      if (e.isOpen !== open) e.setOpen(open);
    });
  }, []);

  const sections = React.useMemo(
    () => [...entriesRef.current].map(([id, e]) => ({ id, ...e.meta, isOpen: e.isOpen, setOpen: e.setOpen })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCount, metaVersion],
  );

  const ctx = React.useMemo(() => ({ register, report, describe }), [register, report, describe]);
  return { ctx, openCount, setAll, sections };
}

export { SidebarSectionsContext };

/**
 * Sidebar collapsible section.
 */
export const SidebarSection = ({
  title,
  icon: Icon,
  testId,
  defaultOpen = true,
  badge,
  // Short status shown on the closed row, e.g. "MNI152 · 0.74 mm".
  summary,
  children,
  // Optional controlled-open mode: when `open` is provided, the parent owns the
  // open/closed state and gets notified via `onOpenChange`. Omit both to keep
  // the default uncontrolled behaviour (internal state seeded by defaultOpen).
  open: openProp,
  onOpenChange,
  keepMounted = false,
  // Module capability this section needs (e.g. "lnm"). While it is missing the
  // heading is greyed out; the section still opens, so its install prompt
  // (ModuleGate) stays one click away. Unknown while module status loads.
  capability,
  // Or the section says itself: false greys the heading, undefined = unknown.
  // `unavailableHint` is its tooltip then.
  available,
  unavailableHint,
}) => {
  const has = useCapability(capability || "__none__");
  const neededModules = useModulesFor(capability || "__none__");
  const { modules: allModules } = useModules();
  const unavailable = available === false || (!!capability && has === false);
  // Preferences: leave a section out while its module is missing. Never while
  // module status is still loading (unavailable is then false, not hidden).
  const [hideUnavailable] = usePreference("hideUnavailableSections");
  // Preferences ▸ Sidebar: left out by choice (or by a preset), and its place
  // in a custom order (CSS order in the sidebar, a sort in the rail).
  const [leftOut] = usePreference("hiddenSections");
  const [savedOrder, setSavedOrder] = usePreference("sectionOrder");
  const hidden = (hideUnavailable && unavailable) || leftOut.includes(testId);
  const order = savedOrder.length ? effectiveOrder(savedOrder).indexOf(testId) : -1;
  // Its module just installed: the section glows once as it unlocks (or
  // slides back in, when hidden while unusable). Not on first load.
  const wasUnavailable = React.useRef(unavailable);
  const [unlocked, setUnlocked] = React.useState(false);
  React.useEffect(() => {
    if (wasUnavailable.current && !unavailable && effectsOn()) setUnlocked(true);
    wasUnavailable.current = unavailable;
  }, [unavailable]);
  const [openState, setOpenState] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (next) => {
    if (next === open) return;
    if (!isControlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const toggle = () => setOpen(!open);

  // Item 105: self-register with the "toggle all" controller. setOpen is routed
  // through a ref so the registered callback always drives the CURRENT
  // open/onOpenChange pair (a controlled section's parent handler changes
  // identity between renders; a stale one would silently no-op).
  const ctl = React.useContext(SidebarSectionsContext);
  const id = React.useId();
  const openRef = React.useRef(open);
  openRef.current = open;
  const setOpenRef = React.useRef(setOpen);
  setOpenRef.current = setOpen;
  React.useEffect(() => {
    if (!ctl || hidden) return undefined;
    return ctl.register(id, {
      isOpen: openRef.current,
      setOpen: (v) => setOpenRef.current(v),
    });
  }, [ctl, id, hidden]);
  React.useEffect(() => { ctl?.report(id, open); }, [ctl, id, open]);

  // What a greyed-out section needs, shown as a pill on its row: one
  // missing module names its size, several are counted.
  const missing = toInstallFor(neededModules, allModules).filter((m) => moduleStatus(m) !== "installed");
  const gatePill = !unavailable ? null
    : missing.length === 1 ? (moduleSize(missing[0]) === "unknown size" ? "Install" : `Install · ${moduleSize(missing[0])}`)
    : missing.length > 1 ? `Add ${missing.length} modules`
    : null;

  React.useEffect(() => {
    ctl?.describe(id, { testId, title, icon: Icon, badge, unavailable, gatePill, order });
  }, [ctl, id, testId, title, Icon, badge, unavailable, gatePill, order]);

  // Movable panels: a grip on the row drags the section. Over the sidebar it
  // reorders (the same saved order as Preferences ▸ Sections); on a viewer
  // edge it docks there; anywhere else it floats as a card. Its content is
  // rendered once into a detached element that is moved between the sidebar,
  // the dock and the card, so its state survives the move.
  const move = usePlacement(testId, "movableSections");
  const floating = move.allowed && move.placement.dock === "float";
  const docked = move.allowed && SIDES.includes(move.placement.dock);
  const dockEl = useDockSlot(testId, docked);
  const dockSlot = React.useRef(null);
  const host = React.useMemo(() => {
    if (!move.allowed) return null;
    const el = document.createElement("div");
    el.className = "space-y-2.5";
    return el;
  }, [move.allowed]);
  const inlineSlot = React.useRef(null);
  const floatSlot = React.useRef(null);
  React.useLayoutEffect(() => {
    const to = floating ? floatSlot.current : docked ? dockSlot.current : inlineSlot.current;
    if (host && to && host.parentNode !== to) to.appendChild(host);
  });
  const rootRef = React.useRef(null);
  const sectionTarget = (x, y) => {
    const nav = rootRef.current?.closest("nav");
    const r = nav?.getBoundingClientRect();
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const items = [...nav.querySelectorAll("[data-section]")]
      .filter((el) => el !== rootRef.current && el.getBoundingClientRect().height > 0)
      .map((el) => { const b = el.getBoundingClientRect(); return { id: el.dataset.testid, top: b.top, bottom: b.bottom }; });
    return { type: "reorder", ...sectionDropTarget(items, y), left: r.left, width: r.width };
  };
  const { onGripDown, overlay } = useGripDrag({
    title,
    kind: testId,
    extraTarget: sectionTarget,
    onDrop: (target, p) => {
      if (target?.type === "reorder") {
        const next = moveBefore(effectiveOrder(savedOrder), testId, target.beforeId);
        setSavedOrder(next.every((sid, i) => sid === SECTION_IDS[i]) ? [] : next);
        if (floating || docked) move.dispatch({ type: "home" });
      } else {
        dropPanel(move.dispatch, target, p, { w: 340, h: 200 });
        setOpen(true);
      }
    },
  });
  const away = floating || docked;

  if (hidden) return null;

  const body = (
    <React.Suspense
      fallback={
        <div className="py-2 text-[12px] text-subtle">
          Loading…
        </div>
      }
    >
      <ChunkErrorBoundary>
        {children}
      </ChunkErrorBoundary>
    </React.Suspense>
  );

  return (
    <div
      ref={rootRef}
      data-section=""
      className={`group/section relative rounded-lg transition-colors ${open || away ? "my-1 border border-border bg-card" : "border border-transparent"} ${unlocked ? "glow-once" : ""}`}
      onAnimationEnd={(e) => { if (e.animationName === "glow-once") setUnlocked(false); }}
      style={order >= 0 ? { order } : undefined}
      data-open={open}
      data-testid={testId}
    >
      <button
        onClick={away ? () => { move.dispatch({ type: "home" }); setOpen(true); } : toggle}
        aria-expanded={open && !away}
        className={`flex h-[38px] w-full items-center gap-2.5 px-2.5 text-left transition-colors ${
          open ? "rounded-t-lg" : "rounded-md hover:bg-panel-hover"
        }`}
        data-testid={`${testId}-toggle`}
        data-unavailable={unavailable || undefined}
        title={!unavailable ? undefined
          : available === false ? unavailableHint
          : `Needs the ${neededModules.map((m) => m.name).join(" / ") || capability} module — open to install it`}
      >
        {Icon && (
          <Icon
            size={16}
            className={`flex-shrink-0 ${open ? "text-foreground" : "text-muted-foreground"} ${unavailable ? "opacity-50" : ""}`}
          />
        )}
        <span
          className={`min-w-[4.5rem] flex-1 truncate text-[13.5px] ${open ? "font-semibold" : "font-medium"} ${
            unavailable ? "text-muted-foreground" : "text-foreground"
          }`}
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </span>
        {summary && !open && (
          <span className="truncate text-[12px] text-subtle">{summary}</span>
        )}
        {badge !== undefined && badge !== null && badge !== 0 && (
          <span className="count" title="Shown now">{badge}</span>
        )}
        {gatePill && (
          <span className="min-w-0 truncate whitespace-nowrap rounded-full border border-edge px-2 text-[11.5px] leading-[18px] text-muted-foreground">
            {gatePill}
          </span>
        )}
        {away && (
          <span className="whitespace-nowrap rounded-full border border-edge px-2 text-[11.5px] leading-[18px] text-muted-foreground"
            title="Click to put it back here">{floating ? "Floating" : "Docked"}</span>
        )}
        {away ? null : open ? (
          <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={14} className="flex-shrink-0 text-subtle" />
        )}
      </button>
      {move.allowed && !away && (
        <span className="absolute right-7 top-[5px] opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100">
          <GripButton title={title} kind={testId} onPointerDown={onGripDown} hint="double-click to float it" className="h-7 w-7 bg-card"
            onDoubleClick={(e) => {
              const pos = floatAt({ x: e.clientX, y: e.clientY }, { w: 340, h: 200 });
              move.dispatch({ type: "float", x: pos.x, y: pos.y });
              setOpen(true);
            }} />
        </span>
      )}
      {overlay}
      {move.allowed && (open || keepMounted || away) && createPortal(body, host)}
      {floating && (
        <FloatingCard kind={testId} title={title} size={{ w: 340 }} placement={move.placement} dispatch={move.dispatch}>
          <div ref={floatSlot} className="p-2.5" />
        </FloatingCard>
      )}
      {docked && dockEl && createPortal(
        <DockedFrame kind={testId} title={title} icon={Icon} onGripDown={onGripDown} onHome={() => move.dispatch({ type: "home" })}>
          <div ref={dockSlot} className="p-2.5" />
        </DockedFrame>, dockEl)}
      {(open || keepMounted) && !away && (
        <div className={`space-y-2.5 px-2.5 pb-2 pt-0.5 ${open ? "" : "hidden"}`}>
          {/* Suspense boundary so lazily code-split panels can stream their chunk
              on first open without a top-level fallback flashing the whole UI.
              With movable panels on, `body` is rendered into a detached element
              (see `host` above) that sits here, or in the floating card. */}
          {move.allowed ? <div ref={inlineSlot} className="contents" /> : body}
          {/* Item: per-section close row, reuses the existing toggle/setOpen
              handler (no new state). Lives inside the same open/keepMounted
              content div as `children`, so the shared `hidden` class above
              already keeps it out of view whenever keepMounted holds a
              closed section mounted — it is never visible unless `open`. */}
          <button
            type="button"
            onClick={toggle}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-[12px] text-subtle transition-colors hover:bg-panel-hover hover:text-foreground"
            data-testid={`${testId}-close`}
          >
            <ChevronUp size={12} />
            Close
          </button>
        </div>
      )}
    </div>
  );
};

/** Small-caps heading over a group of sidebar sections (Volumes, Analysis, Reference). */
export const SidebarGroup = ({ children }) => (
  <div className="cap px-2.5 pb-1.5 pt-3.5 text-subtle first:pt-1.5">{children}</div>
);

export default SidebarSection;
