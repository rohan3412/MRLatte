import React, { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { getFixPreview, subscribeFixPreview, startFixPreview, applyFixPreview, cancelFixPreview } from "@/lib/fixPreview";
import { undoToastOptions } from "@/lib/undoToast";

/**
 * Start a fix preview from a quality note (lib/fixPreview.js), saying so when
 * there is nothing to change or the backend fails. The note's dialog closes
 * before this runs.
 */
export async function previewFindingFix({ viewerRef, finding, mni }) {
  try {
    const fix = await startFixPreview({ viewerRef, finding, mni });
    if (!fix) toast.info("Nothing to change", { description: "The drawing has already changed there." });
  } catch (e) {
    toast.error("Couldn't preview this fix", { description: e?.message });
  }
}

const n = (v) => Number(v || 0).toLocaleString();

/**
 * The bar over the viewer while a fix is previewed: what it would add (green
 * on the image) and remove (blue), with Apply and Cancel. Mounted once, over
 * the viewer; renders nothing without a preview.
 */
export function FixPreviewBar({ viewerRef }) {
  const [preview, setPreview] = useState(getFixPreview);
  useEffect(() => subscribeFixPreview(setPreview), []);
  if (!preview) return null;
  const { fix } = preview;

  const apply = async () => {
    const res = await applyFixPreview();
    if (!res) { toast.error("The drawing could not take the fix", { description: "Has the base scan changed?" }); return; }
    if (!res.added && !res.removed) { toast.info("Nothing to change", { description: "The drawing has already changed there." }); return; }
    const what = [res.added && `added ${n(res.added)}`, res.removed && `removed ${n(res.removed)}`].filter(Boolean).join(", ");
    toast.success(`Fixed: ${what} voxel${res.added + res.removed === 1 ? "" : "s"}`, {
      ...undoToastOptions(),
      description: fix.label || fix.id,
      action: { label: "Undo", onClick: () => viewerRef.current?.drawUndo?.() },
    });
  };

  return (
    <div
      className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 border border-edge bg-panel px-3 py-2 text-[12px] shadow-elev-2 rounded-lg"
      role="status"
      data-testid="fix-preview-bar"
    >
      <Wand2 size={13} className="shrink-0 text-warn" />
      <div className="min-w-0">
        <div className="font-medium text-foreground">{fix.label || "Fix"}</div>
        <div className="text-muted-foreground">
          {fix.voxels_added > 0 && <span className="mr-2"><span className="text-[#3fbf5f]">■</span> adds {n(fix.voxels_added)}</span>}
          {fix.voxels_removed > 0 && <span><span className="text-[#4d7cff]">■</span> removes {n(fix.voxels_removed)}</span>}
          {" "}voxel{fix.voxels_added + fix.voxels_removed === 1 ? "" : "s"}
        </div>
      </div>
      <button onClick={cancelFixPreview} className="btn px-2.5" data-testid="fix-preview-cancel">Cancel</button>
      <button onClick={apply} className="px-2.5 py-1 font-medium btn-primary" data-testid="fix-preview-apply">Apply</button>
    </div>
  );
}

export default FixPreviewBar;
