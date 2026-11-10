import React from "react";
import { FileText } from "lucide-react";
import { SidebarSection } from "@/components/SidebarSection";
import { visualFieldMap2DDataURL } from "@/components/VisualFieldMap2D";
import { computeVoxelCounts2D } from "@/lib/retinotopyAnalysis";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Code-split: only rendered inside an open SidebarSection.
const ReportPanel = lazyWithRetry(() => import("@/components/ReportPanel"));

/**
 * Report sidebar section (inbox 2 Nov): the one place a lesion's report is
 * made. Each lesion card has a "Report" button that opens this section with
 * that lesion chosen (Dashboard's openReportFor). Holds the visual-field map
 * generators the report embeds.
 */
export function ReportSection({
  open,
  onOpenChange,
  lesionLayers,
  reportLesionId,
  setReportLesionId,
  viewerRef,
  standardAtlases,
  atlasState,
  ensureAtlasRegions,
  ensureAtlasLoaded,
  userFileCache,
  ensureRetinotopyLoaded,
  retinoVolume,
  polarThresh,
  allRetinotopyLayers,
}) {
  // The 2D visual-field map for ONE lesion, from the retinotopy maps
  // (off-screen, via retinoVolume), not a capture of the Retinotopy panel,
  // whose state has nothing to do with the report being made. Null when a map
  // isn't loaded.
  const vfMapFor = async (lesionId, paId, ecId, thresh = {}) => {
    const lv = viewerRef.current?.getVolume?.(lesionId);
    const pa = retinoVolume(paId);
    const ec = retinoVolume(ecId);
    if (!(pa?.img && ec?.img && lv?.img)) return null;
    return await visualFieldMap2DDataURL({
      gridResult: computeVoxelCounts2D(lv, pa, ec), active: true, selectedCount: 1, ...thresh,
    });
  };
  const bensonThresh = { thresholdMode: polarThresh.mode, thresholdMin: polarThresh.min };

  return (
    <SidebarSection title="Report" icon={FileText} testId="section-report"
      open={open} onOpenChange={onOpenChange} keepMounted>
      <ReportPanel
        viewerRef={viewerRef}
        lesionId={reportLesionId}
        onLesionChange={setReportLesionId}
        lesionLayers={lesionLayers}
        standardAtlases={standardAtlases}
        visibleAtlasIds={standardAtlases.filter((a) => atlasState[a.id]?.visible).map((a) => a.id)}
        ensureAtlasRegions={ensureAtlasRegions}
        ensureAtlasLoaded={ensureAtlasLoaded}
        userFileCache={userFileCache}
        retinoVolume={retinoVolume}
        retinotopyLayers={allRetinotopyLayers
          .filter((l) => l.legendType === "polar" || l.legendType === "eccen")
          .map((l) => ({
            id: l.id,
            name: l.name,
            kind: l.legendType,
            illustrative: l.id.startsWith("wm_") || l.id.startsWith("lgn_") || l.id.startsWith("or_"),
            attribution: l.attribution || null,
          }))}
        getVfMap2dDataUrl={async (lesionId) => {
          // The cortical (Benson) maps are loaded first, silently.
          await ensureRetinotopyLoaded("benson_polar_angle", { silent: true });
          await ensureRetinotopyLoaded("benson_eccentricity", { silent: true });
          return await vfMapFor(lesionId, "benson_polar_angle", "benson_eccentricity", bensonThresh);
        }}
        getWmVfMap2dDataUrl={(lesionId) => vfMapFor(lesionId, "wm_polar_angle", "wm_eccentricity")}
      />
    </SidebarSection>
  );
}

export default ReportSection;
