// A lesion mask opened in Draw mask (Edit) and saved again should look the way
// it did before (inbox 29 Oct: a red mask came back blue). Edit removes the
// layer and Save adds a new one, so without this the saved layer took the next
// palette colour and every other default.

const num = (v) => typeof v === "number" && Number.isFinite(v);

/** The display settings worth keeping, from a layer's userLayers entry and
 *  its overlayMeta. Null when there is no layer. */
export function captureLayerStyle(layer, meta = {}) {
  if (!layer) return null;
  return {
    colormap: layer.colormap,
    opacity: layer.opacity,
    colormapInverted: !!meta.colormapInverted,
    calMin: meta.cal_min,
    calMax: meta.cal_max,
    colorMin: meta.color_min,
    colorMax: meta.color_max,
    colorLocked: !!meta.colorLocked,
  };
}

/** The ranges to re-apply to the saved layer, whose data now peaks at
 *  `dataMax`. A visibility range that starts above every value the edited mask
 *  holds would hide it entirely, so that one is dropped (the layer keeps its
 *  default); the colour range only scales colours and always carries. */
export function rangesToReapply(style, dataMax) {
  const out = {};
  if (!style) return out;
  if (num(style.calMin) && num(style.calMax)) {
    const lo = Math.min(style.calMin, style.calMax);
    if (!(num(dataMax) && dataMax < lo)) out.cal = [style.calMin, style.calMax];
  }
  if (num(style.colorMin) && num(style.colorMax)) out.color = [style.colorMin, style.colorMax];
  return out;
}
