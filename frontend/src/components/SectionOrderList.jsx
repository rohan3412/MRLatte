import React, { useLayoutEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { usePreference } from "@/lib/preferences";
import { SECTIONS, SECTION_IDS, effectiveOrder } from "@/lib/sections";
import { effectsOn } from "@/lib/viewer/effects";

const TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
const GROUP = Object.fromEntries(SECTIONS.map((s) => [s.id, s.group]));
const MOVE = "transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1)";

/**
 * Preferences ▸ Sidebar: which sections show, and in what order (owner,
 * 5 Nov: drag to reorder, with smooth movement). Drag a row by its handle, or
 * focus the handle and press Alt+Up / Alt+Down. The order is kept while
 * dragging and saved on drop; an order back to the default is saved as "no
 * custom order", which brings the sidebar's group headings back.
 *
 * Movement is FLIP: before the list re-renders in its new order every row's
 * position is noted, and after it each row starts where it was and glides
 * home with a transform (cheap: no layout per frame). The dragged row follows
 * the pointer instead. No animation under reduced motion / Visual effects off.
 */
export function SectionOrderList() {
  const [saved, setSaved] = usePreference("sectionOrder");
  const [leftOut, setLeftOut] = usePreference("hiddenSections");
  const [live, setLiveState] = useState(null);        // the order while dragging
  const liveRef = useRef(null);                        // the same, for the window listeners
  const setLive = (v) => { liveRef.current = v; setLiveState(v); };
  const order = live || effectiveOrder(saved);
  const rows = useRef(new Map());
  const before = useRef(null);
  const drag = useRef(null);                           // { id, grab, el }
  const animate = effectsOn();

  const snapshot = () => {
    before.current = new Map([...rows.current].map(([id, el]) => [id, el.getBoundingClientRect().top]));
  };

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    // The dragged row just moved in the layout: keep it under the pointer.
    const d = drag.current;
    if (d && d.lastY != null) {
      const top = d.el.getBoundingClientRect().top - (parseFloat(d.el.dataset.dy) || 0);
      const dy = d.lastY - d.grab - top;
      d.el.dataset.dy = String(dy);
      d.el.style.transform = `translateY(${dy}px)`;
    }
    if (!prev || !animate) return;
    for (const [id, el] of rows.current) {
      if (id === d?.id) continue;
      const dy = (prev.get(id) ?? 0) - el.getBoundingClientRect().top;
      if (!dy) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => { el.style.transition = MOVE; el.style.transform = ""; });
    }
  });

  const save = (next) => {
    setSaved(next.every((id, i) => id === SECTION_IDS[i]) ? [] : next);
  };

  const moveTo = (list, id, index) => {
    const next = list.filter((x) => x !== id);
    next.splice(index, 0, id);
    return next;
  };

  // The pointer is followed on window, not by capturing it on the handle:
  // reordering moves the row in the DOM, and a moved element loses capture.
  const onPointerDown = (e, id) => {
    const el = rows.current.get(id);
    if (!el || e.button !== 0) return;
    e.preventDefault();
    drag.current = { id, el, grab: e.clientY - el.getBoundingClientRect().top };
    el.style.transition = "none";
    el.dataset.dragging = "";
    setLive(order);
    const up = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onPointerUp();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    d.lastY = e.clientY;
    const list = liveRef.current || order;
    // Where the row would sit under the pointer, and which slot that is: the
    // first other row whose middle is below the dragged row's middle.
    const shift = (top) => e.clientY - d.grab - top;
    const layoutTop = d.el.getBoundingClientRect().top - (parseFloat(d.el.dataset.dy) || 0);
    const mid = e.clientY - d.grab + d.el.offsetHeight / 2;
    let index = 0;
    for (const id of list) {
      if (id === d.id) continue;
      const r = rows.current.get(id)?.getBoundingClientRect();
      if (r && mid > r.top + r.height / 2) index += 1;
    }
    if (list.indexOf(d.id) !== index) {
      snapshot();
      setLive(moveTo(list, d.id, index));
    }
    const dy = shift(layoutTop);
    d.el.dataset.dy = String(dy);
    d.el.style.transform = `translateY(${dy}px)`;
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // Settle into the slot.
    d.el.style.transition = animate ? MOVE : "none";
    d.el.style.transform = "";
    delete d.el.dataset.dragging;
    delete d.el.dataset.dy;
    if (liveRef.current) save(liveRef.current);
    setLive(null);
  };

  const onKeyDown = (e, id) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = order.indexOf(id);
    const j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    snapshot();
    save(moveTo(order, id, j));
    requestAnimationFrame(() => rows.current.get(id)?.querySelector("[data-grip]")?.focus());
  };

  const allShown = leftOut.length === 0;
  return (
    <div className="space-y-2" data-testid="section-order">
      <ul className="relative space-y-1">
        {order.map((id) => (
          <li
            key={id}
            ref={(el) => { if (el) rows.current.set(id, el); else rows.current.delete(id); }}
            className="section-order-row flex items-center gap-2 rounded-md border border-border bg-card px-1.5 py-1"
            data-testid={`section-order-${id}`}
          >
            <button
              type="button"
              data-grip=""
              onPointerDown={(e) => onPointerDown(e, id)}
              onKeyDown={(e) => onKeyDown(e, id)}
              className="icon-btn h-6 w-6 flex-shrink-0 cursor-grab touch-none active:cursor-grabbing"
              aria-label={`Move ${TITLE[id]} (Alt+Up / Alt+Down)`}
              title="Drag to reorder, or Alt+Up / Alt+Down"
            >
              <GripVertical size={14} />
            </button>
            <span className={`min-w-0 flex-1 truncate text-[13px] ${leftOut.includes(id) ? "text-subtle" : "text-foreground"}`}>
              {TITLE[id]}
            </span>
            <span className="cap flex-shrink-0 text-subtle">{GROUP[id]}</span>
            <Switch
              checked={!leftOut.includes(id)}
              onCheckedChange={(on) => setLeftOut(on ? leftOut.filter((x) => x !== id) : [...leftOut, id])}
              label={`Show ${TITLE[id]}`}
              testId={`section-show-${id}`}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-mini" disabled={allShown} onClick={() => setLeftOut([])}
          data-testid="section-show-all">Show everything</button>
        <button type="button" className="btn-mini" disabled={!saved.length} onClick={() => { snapshot(); setSaved([]); }}
          data-testid="section-order-reset">Default order</button>
      </div>
    </div>
  );
}

export default SectionOrderList;
