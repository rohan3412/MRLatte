// The toolbar docked left or right is one column of icons. In a short window
// that column can be taller than the strip, and the last tools (Open, Save)
// fall off the bottom (the on-screen layout test, 12 Nov). The strip can't
// simply grow sideways: it is a size container (index.css), so its width never
// follows its content. Instead, when its tools don't fit, it is marked
// `data-crowded` and index.css gives it two columns at a fixed width.
//
// Measured without the mark each time (the browser lays out but doesn't paint
// in between), whenever the strip's size, its tools or its orientation change.

/** Watch `el` (the toolbar); returns a function that stops watching. */
export function watchToolbarCrowding(el) {
  if (!el || typeof ResizeObserver === "undefined") return () => {};
  const update = () => {
    delete el.dataset.crowded;
    if (el.dataset.vertical === undefined) return;   // only the vertical strip
    if (el.scrollHeight > el.clientHeight + 1) el.dataset.crowded = "";
  };
  const resize = new ResizeObserver(update);
  const mutate = new MutationObserver(update);
  resize.observe(el);
  mutate.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-vertical", "data-expanded"] });
  update();
  return () => {
    resize.disconnect();
    mutate.disconnect();
    delete el.dataset.crowded;
  };
}

/** A ref callback for the toolbar element (create it once and keep it). */
export function crowdingRef() {
  let stop = () => {};
  return (el) => {
    stop();
    stop = el ? watchToolbarCrowding(el) : () => {};
  };
}
