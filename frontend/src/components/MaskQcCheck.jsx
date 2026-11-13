import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { runLesionQc, qcFixedCopy } from "@/lib/lesionQc";
import { LesionQcDialog, findingMM } from "@/components/LesionQcDialog";
import { useLesionEngine } from "@/hooks/use-modules";

/**
 * lqtpy's quality check on a LOADED lesion mask, on demand (inbox 28 Oct: a
 * drawing is checked before Save and after idle time, a loaded mask never
 * was). Check is the basic QC: it lists the findings, with Go to. Fix is the
 * step after it, per finding in that list, and makes a corrected copy as a new
 * layer: the mask's own file is never changed.
 */
export function MaskQcCheck({ lesion, userFileCache, mni, viewerRef, onAddFixedCopy }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { flags, verdict, lesionId } while the dialog is open
  const engine = useLesionEngine();

  const check = async () => {
    const file = userFileCache?.current?.[lesion.id]?.file;
    if (!file) { toast.error("This mask's file isn't available to check"); return; }
    setBusy(true);
    // No viewerRef: the drawing's own context (which slices were drawn by
    // hand) says nothing about a mask loaded from a file.
    const r = await runLesionQc({ file, mni, fileName: file.name });
    setBusy(false);
    if (!r) {
      toast.error("The quality check couldn't run", { description: "lqtpy isn't available in this backend, or the check took too long." });
      return;
    }
    if (!r.flags.length) {
      toast.success("No issues found", { description: r.verdict ? `Overall: ${r.verdict}` : lesion.name });
      viewerRef.current?.fxRingAroundLayer?.(lesion.id);
      return;
    }
    // The viewer glides to the first finding that has a place, behind the list.
    const first = r.flags.map(findingMM).find(Boolean);
    if (first) viewerRef.current?.fxGlideTo?.(first);
    setResult({ ...r, fileName: file.name });
  };

  const fix = async (finding) => {
    const { lesionId, fileName } = result;
    setResult(null);
    try {
      // Named after the mask's FILE, as the new layer will be on load.
      const { file, removed } = await qcFixedCopy({ lesionId, findingId: finding.id, name: fileName });
      if (!file) { toast.info("Nothing to remove", { description: finding.label || finding.id }); return; }
      await onAddFixedCopy(file);
      toast.success(`Added ${file.name}`, {
        description: `${removed.toLocaleString()} voxel${removed === 1 ? "" : "s"} removed in the copy. The original mask is unchanged.`,
      });
    } catch (e) {
      toast.error("Couldn't fix this automatically", { description: e?.message });
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid={`mask-qc-${lesion.id}`}>
      <span className="flex-1 text-[13px] text-muted-foreground">Quality check</span>
      <button
        onClick={engine.missing ? engine.install : check}
        disabled={busy}
        className="btn-mini"
        title={engine.missing
          ? "The quality check needs the LQTpy module. Opens the module store at it."
          : "Check this mask with lqtpy: stray specks, gaps between slices, parts outside the brain…"}
        data-testid={`mask-qc-check-${lesion.id}`}
      >
        <ShieldCheck size={11} />
        {engine.missing ? "Install LQTpy…" : busy ? "Checking…" : "Check"}
      </button>
      {result && (
        <LesionQcDialog
          open
          readOnly
          subject="lesion mask"
          flags={result.flags}
          verdict={result.verdict}
          engineVersion={result.provenance?.version}
          onCancel={() => setResult(null)}
          onGoTo={(mm, plane) => { setResult(null); viewerRef.current?.setCrosshairMM?.(mm[0], mm[1], mm[2], plane); }}
          onFix={fix}
        />
      )}
    </div>
  );
}

export default MaskQcCheck;
