import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { dragHudVisible } from "@/lib/windowDrag";

// Readout while right-drag windows the base (inbox 4 Nov: "a better window
// drag, with drag parameters displayed"). It appears beside the point where
// the drag began and stays there (inbox 4 Nov, later: "fixed from the point
// where i drag, not follow the mouse"). A 2D grid whose
// x axis is the window's width and y axis its level, both across the scan's
// whole data range: the dot is the window now, the ring where the drag began.
// Fed imperatively (`ref.current.update(info)`) so a drag re-renders only
// this, not the dashboard. Fades out shortly after the drag ends.
const GRID = 64;
const HIDE_AFTER_MS = 900;

function fmt(v, range) {
  if (!Number.isFinite(v)) return "–";
  const d = range >= 100 ? 0 : range >= 1 ? 2 : 3;
  return v.toFixed(d);
}

export const WindowDragHud = forwardRef(function WindowDragHud(_props, ref) {
  const [info, setInfo] = useState(null);
  const [visible, setVisible] = useState(false);
  const boxRef = useRef(null);
  const hideTimer = useRef(null);
  const [anchor, setAnchor] = useState(null); // where the drag began, in client px

  // Where this drag began and whether its readout has shown yet (refs: read
  // on every update, which arrive faster than renders).
  const press = useRef(null);
  const shown = useRef(false);
  useImperativeHandle(ref, () => ({
    update(next) {
      clearTimeout(hideTimer.current);
      const pointer = { x: next.clientX, y: next.clientY };
      if (next.phase === "start" || !press.current) {
        press.current = pointer;
        shown.current = false;
        setAnchor(pointer);
      }
      shown.current = dragHudVisible({ phase: next.phase, start: press.current, pointer, shown: shown.current });
      setInfo(next);
      if (shown.current) setVisible(true);
      if (next.phase === "end") {
        press.current = null;
        if (shown.current) hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
        else setVisible(false);
      }
    },
  }), []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // Beside the drag's starting point, kept inside the viewer; placed once per
  // drag, so it holds still while the pointer moves.
  useEffect(() => {
    const el = boxRef.current;
    const host = el?.offsetParent;
    const a = anchor;
    if (!el || !host || !a) return;
    const r = host.getBoundingClientRect();
    let x = a.x - r.left + 18;
    let y = a.y - r.top + 18;
    if (x + el.offsetWidth > r.width - 6) x = a.x - r.left - el.offsetWidth - 18;
    if (y + el.offsetHeight > r.height - 6) y = a.y - r.top - el.offsetHeight - 18;
    el.style.left = `${Math.max(6, x)}px`;
    el.style.top = `${Math.max(6, y)}px`;
  }, [anchor]);

  if (!info) return null;
  const { lo, hi, level, width, gmin, gmax, startLevel, startWidth, fine } = info;
  const range = gmax > gmin ? gmax - gmin : 1;
  const px = (w) => Math.min(GRID, Math.max(0, (w / range) * GRID));
  const py = (l) => Math.min(GRID, Math.max(0, GRID - ((l - gmin) / range) * GRID));

  return (
    <div
      ref={boxRef}
      className={`popover pointer-events-none absolute z-30 flex items-center gap-3 px-3 py-2.5 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      role="status"
      aria-live="off"
      data-testid="window-drag-hud"
    >
      <svg width={GRID + 2} height={GRID + 2} viewBox={`-1 -1 ${GRID + 2} ${GRID + 2}`} aria-hidden="true" className="flex-shrink-0">
        <rect x="0" y="0" width={GRID} height={GRID} rx="3" className="fill-panel-hover stroke-edge" strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} className="stroke-border" strokeWidth="1">
            <line x1={f * GRID} y1="0" x2={f * GRID} y2={GRID} />
            <line x1="0" y1={f * GRID} x2={GRID} y2={f * GRID} />
          </g>
        ))}
        {/* Where the window can go: it stays inside the data range, so a wide
            window has little room to move. These two limits close the
            reachable area into a triangle, the edge the dot stops at. */}
        <g stroke="#E5484D" strokeWidth="1" strokeDasharray="2 2" fill="none" data-testid="window-drag-hud-bounds">
          <line x1="0" y1="0" x2={GRID} y2={GRID / 2} />
          <line x1="0" y1={GRID} x2={GRID} y2={GRID / 2} />
        </g>
        <circle cx={px(startWidth)} cy={py(startLevel)} r="3.5" className="fill-none stroke-subtle" strokeWidth="1.25" />
        <circle cx={px(width)} cy={py(level)} r="3.5" className="fill-crema" data-testid="window-drag-hud-dot" />
      </svg>
      <div className="grid grid-cols-[auto_auto] gap-x-2.5 gap-y-0.5 font-mono text-[11px] leading-tight tabular-nums">
        <span className="text-subtle">Level</span><span className="text-right text-foreground" data-testid="window-drag-level">{fmt(level, range)}</span>
        <span className="text-subtle">Width</span><span className="text-right text-foreground" data-testid="window-drag-width">{fmt(width, range)}</span>
        <span className="text-subtle">Shows</span><span className="text-right text-foreground">{fmt(lo, range)} – {fmt(hi, range)}</span>
        <span className="col-span-2 pt-1 font-sans text-[10.5px] text-subtle">
          {fine ? "Fine (Shift held)" : "↕ level · ↔ width · Shift: fine"}
        </span>
      </div>
    </div>
  );
});

export default WindowDragHud;
