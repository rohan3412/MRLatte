// Previewing one lqtpy fix on the drawing before applying it (lqtpy 0.8.0,
// qc.fix_plan). The voxels the fix would add show in green, those it would
// remove in blue, as two temporary overlays; FixPreviewBar offers Apply (one
// undoable edit, with the current pen's colour) or Cancel. Unlike the older
// one-click Fix this covers the fixes that ADD voxels too (skipped slices,
// holes, unfilled outlines): the person sees them first.
//
// One preview at a time, shared by every place that shows quality notes (the
// Save check, Check drawing, the live badge's details), so the bar lives once
// over the viewer and the dialogs only start it.
import { fetchFixPlan, uploadLesion } from "@/lib/lesionMetrics";
import { currentDrawingAsFile } from "@/lib/lesions";

const ADDED = "__qc_fix_added";
const REMOVED = "__qc_fix_removed";

let state = null;
const listeners = new Set();
const setState = (s) => { state = s; listeners.forEach((fn) => fn(s)); };

export const getFixPreview = () => state;
export function subscribeFixPreview(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const maskFile = (b64, name) =>
  new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: "application/gzip" });

const clearOverlays = (viewer) => {
  viewer?.removeOverlayByName?.(ADDED);
  viewer?.removeOverlayByName?.(REMOVED);
};

/**
 * Show what lqtpy's fix for `finding` would change, worked out from the
 * drawing as it is now (uploads are content-addressed, so an unchanged drawing
 * isn't sent twice); `mni` as the check that found it. Throws on a backend
 * error (the user asked for it).
 * @returns {Promise<object|null>} the fix shown, or null when it would change nothing
 */
export async function startFixPreview({ viewerRef, finding, mni = true }) {
  cancelFixPreview();
  const file = await currentDrawingAsFile(viewerRef, "qc_fix_drawing.nii.gz");
  if (!file) return null;
  const lesionId = await uploadLesion(file);
  const context = { labels_are_colours: true, ...(viewerRef?.current?.getDrawingContext?.() || {}) };
  const id = finding?.advice?.fix_id || finding?.id;
  const res = await fetchFixPlan({ lesionId, findingIds: [id], context, mni });
  const fix = (res.fixes || []).find((f) => f.id === id);
  if (!fix || !(fix.voxels_added || fix.voxels_removed)) return null;
  const added = fix.voxels_added ? maskFile(fix.added_mask, "qc_fix_added.nii.gz") : null;
  const removed = fix.voxels_removed ? maskFile(fix.removed_mask, "qc_fix_removed.nii.gz") : null;
  const viewer = viewerRef?.current;
  // `overlayKind: "lesion"`: a mask, so its zero background stays clear
  // instead of veiling the whole scan.
  if (added) await viewer?.addOverlayFromFile?.(added, { name: ADDED, colormap: "green", opacity: 0.85, overlayKind: "lesion" });
  if (removed) await viewer?.addOverlayFromFile?.(removed, { name: REMOVED, colormap: "blue", opacity: 0.95, overlayKind: "lesion" });
  setState({ viewerRef, fix, added, removed, drawing: fingerprint(viewer) });
  return fix;
}

// A cheap fingerprint of the drawing: the viewer's draw-change notice also
// fires when nothing changed (NiivueViewer's emitHistory says so), and a
// preview should only go when the drawing really did.
function fingerprint(viewer) {
  const bm = viewer?.getNiivue?.()?.drawBitmap;
  if (!bm) return null;
  let h = 0;
  for (let i = 0; i < bm.length; i++) if (bm[i]) h = (h * 31 + i * 7 + bm[i]) >>> 0;
  return `${bm.length}:${h}`;
}

/** The drawing changed under the preview: drop it. A notice with no change keeps it. */
export function cancelFixPreviewIfDrawingChanged() {
  if (state && fingerprint(state.viewerRef?.current) !== state.drawing) cancelFixPreview();
}

/** Apply the fix on show to the drawing. @returns {Promise<{added: number, removed: number}|null>} */
export async function applyFixPreview() {
  const s = state;
  if (!s) return null;
  clearOverlays(s.viewerRef?.current);
  setState(null);
  return s.viewerRef?.current?.applyFixMasks?.({ added: s.added, removed: s.removed }) ?? null;
}

/** Drop the preview (Cancel, or the drawing changed under it). */
export function cancelFixPreview() {
  const s = state;
  if (!s) return;
  clearOverlays(s.viewerRef?.current);
  setState(null);
}
