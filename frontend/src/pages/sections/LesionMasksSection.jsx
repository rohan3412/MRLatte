import React from "react";
import { FileText, Plus } from "lucide-react";
import { SidebarSection } from "@/components/SidebarSection";
import FileUploader from "@/components/FileUploader";
import { UserLayerList } from "@/components/UserLayerList";
import { MaskQcCheck } from "@/components/MaskQcCheck";
import { Disclosure } from "@/components/ui/disclosure";
import { serialUpload } from "@/lib/uploadUtils";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Code-split, same reasoning as Dashboard.jsx's other lazy panels: only
// rendered inside a collapsed SidebarSection, so lazyWithRetry defers the
// chunk until the user opens Lesion Masks, and retries once on network failure.
const OverlapPanel = lazyWithRetry(() => import("@/components/OverlapPanel"));

/**
 * Lesion Masks sidebar section: upload lesion masks, per-layer controls (via
 * UserLayerList), the quality check and atlas overlap table per lesion, and a
 * button that opens the Report section for that lesion (onOpenReport).
 *
 * Extracted from Dashboard.jsx; behaviour and markup are unchanged — this is
 * a relocation, not a redesign.
 */
export function LesionMasksSection({
  lesionSectionOpen,
  setLesionSectionOpen,
  lesionLayers,
  addUserFile,
  viewerRef,
  standardAtlases,
  ensureAtlasRegions,
  ensureAtlasLoaded,
  userFileCache,
  overlayMeta,
  handleUserEdit,
  handleUserDuplicate,
  handleUserDownload,
  handleUserToggle,
  handleUserOpacity,
  handleUserColormap,
  handleUserColormapInvert,
  handleUserClipChange,
  handleUserTransform,
  handleUserRemove,
  handleCalRangeChange,
  handleColorRangeChange,
  handleAutoColorRange,
  handleAutoThreshold,
  handleIgnoreZeroChange,
  handleInvertThresholdChange,
  histograms,
  requestHistogram,
  thresholdVolumes,
  scheduleThresholdVolume,
  selectedLesionIds,
  layerNotes,
  onNotesChange,
  // Whether lqtpy's brain-mask checks apply (the base is the MNI template):
  // the same answer the drawing's quality check uses.
  qcMni,
  // Opens the Report section with this lesion chosen (Dashboard).
  onOpenReport,
}) {
  return (
    <SidebarSection title="Lesion masks" icon={Plus} testId="section-lesion"
      open={lesionSectionOpen} onOpenChange={setLesionSectionOpen} keepMounted
      badge={lesionLayers.filter((l) => l.visible).length}>
      <FileUploader label="Load lesion masks" description=".nii .nii.gz .mgz .mif · overlaid in red · several at once"
        testId="upload-lesion-button" multiple
        onFiles={serialUpload((f) => addUserFile(f, "lesion"))}
        onFile={(f) => addUserFile(f, "lesion")} />
      {/* Item 105: the per-lesion tools are mounted INSIDE the lesion they act
          on, via LayerControlAdvanced's `extra` slot, scoped by passing just
          that layer. The report itself lives in the Report section (inbox
          2 Nov); the lesion's Report button opens it with this lesion chosen. */}
      <UserLayerList layers={lesionLayers} overlayMeta={overlayMeta} onEdit={handleUserEdit} onDuplicate={handleUserDuplicate} onDownload={handleUserDownload}
        layerNotes={layerNotes} onNotesChange={onNotesChange}
        {...{ handleUserToggle, handleUserOpacity, handleUserColormap, handleUserColormapInvert, handleUserClipChange, handleUserTransform, handleUserRemove, handleCalRangeChange, handleColorRangeChange, handleAutoColorRange, handleAutoThreshold, handleIgnoreZeroChange, handleInvertThresholdChange, histograms, requestHistogram, thresholdVolumes, scheduleThresholdVolume }}
        renderLayerExtra={(lesion) => (
          <div className="space-y-2">
            {/* The quality check and Report are rows; the overlap table folds
                away under its name. */}
            <div className="cap text-subtle">Analyse this lesion</div>
            <MaskQcCheck lesion={lesion} userFileCache={userFileCache} mni={qcMni} viewerRef={viewerRef}
              onAddFixedCopy={(file) => addUserFile(file, "lesion")} />
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px] text-muted-foreground">Report</span>
              <button
                type="button"
                onClick={() => onOpenReport?.(lesion.id)}
                className="btn min-h-[26px] gap-1.5 px-2.5 text-[12px]"
                title="Opens the Report section with this lesion chosen"
                data-testid={`report-open-${lesion.id}`}
              >
                <FileText size={12} />Report…
              </button>
            </div>
            <Disclosure title="Lesion ∩ atlas overlap" className="border-t border-border" testId={`overlap-fold-${lesion.id}`}>
              <OverlapPanel
                bare
                viewerRef={viewerRef}
                lesionLayers={[lesion]}
                // All installed atlases, not just the ones currently toggled
                // visible — OverlapPanel loads whichever is picked on demand
                // via ensureAtlasLoaded. Filtering by `visible` here made the
                // dropdown look empty until the user first switched an atlas
                // on in the Atlases section.
                atlasOptions={standardAtlases}
                ensureAtlasRegions={ensureAtlasRegions}
                ensureAtlasLoaded={ensureAtlasLoaded}
                // lqtpy migration: resolves an uploaded lesion's cached File
                // for the backend upload, same cache OneClickSummaryPanel
                // already reads (falls back to the in-memory drawing).
                userFileCache={userFileCache}
              />
            </Disclosure>
          </div>
        )}
      />
    </SidebarSection>
  );
}

export default LesionMasksSection;
