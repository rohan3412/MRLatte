import React, { useRef, useState } from "react";
import { Download, FlaskConical } from "lucide-react";
import { overlapToCSV, flattenOverlap, downloadText } from "@/lib/volumeAnalysis";
import { loadAtlasesForReading } from "@/lib/atlasLoad";
import { activeToggleCls } from "@/lib/buttonVariants";
import { resolveLesionAtlasMetrics, engineProvenanceLabel } from "@/lib/lesionReport";
import { currentDrawingAsFile } from "@/lib/lesions";
import { isDevBuild, useLesionEngineDevOverride } from "@/lib/lesionMetrics";

import { toast } from "sonner";

/**
 * Lesion → Atlas overlap table (MRIcroGL-style).
 * For a lesion and one or more atlases, % overlap per region, one table with
 * an Atlas column.
 * Engine defaults to lqtpy (backend/lesion_metrics.py) via
 * resolveLesionAtlasMetrics, falling back visibly to the JS engine
 * (computeAtlasOverlap) when lqtpy is unavailable or a dev toggle forces it.
 */
// `bare`: no heading of its own, for a caller that folds it under one.
export const OverlapPanel = ({ viewerRef, lesionLayers, atlasOptions, ensureAtlasRegions, ensureAtlasLoaded, userFileCache, bare = false }) => {
  const [lesionId, setLesionId] = useState("");
  // Several atlases at once (inbox 2 Nov). null = not chosen yet: the first
  // installed atlas, as the single-atlas dropdown defaulted to.
  const [picked, setPicked] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [provenance, setProvenance] = useState(null);
  const [note, setNote] = useState(null); // excluded-atlas / fallback note shown above the table
  const [devEngine, setDevEngine] = useLesionEngineDevOverride();
  // §6 stale-response guard: a lesion/atlas change (or a second Compute click)
  // while a request is in flight must not let the OLD response overwrite the
  // state a newer request already set.
  const requestIdRef = useRef(0);

  const selected = picked ?? new Set(atlasOptions[0] ? [atlasOptions[0].id] : []);
  const toggleAtlas = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  const resolveLesionFile = async (lid) => {
    const cached = userFileCache?.current?.[lid]?.file;
    if (cached) return cached;
    return currentDrawingAsFile(viewerRef, `${lid}.nii.gz`);
  };

  // Every INSTALLED atlas is offered, not only the ones toggled visible in
  // the Atlases section; the chosen ones are loaded on demand below, the way
  // the Report section does it.
  const runOverlap = async () => {
    const nv = viewerRef.current?.getNiivue();
    if (!nv) return;
    const lid = lesionId || lesionLayers[0]?.id;
    const chosen = atlasOptions.filter((a) => selected.has(a.id));
    if (!lid || !chosen.length) return toast.error("Pick at least one atlas");
    const lesionVol = nv.volumes.find((v) => v?.name === lid);
    if (!lesionVol) return toast.error("Lesion layer is not loaded");
    const myRequestId = ++requestIdRef.current;
    setBusy(true);
    setNote(null);
    try {
      // Loaded silently if not in the viewer yet (they need not be visible).
      const loaded = await loadAtlasesForReading(chosen, {
        viewerRef, ensureAtlasLoaded, ensureRegions: ensureAtlasRegions,
      });
      const failed = chosen.filter((a) => !loaded.some((l) => l.id === a.id));
      if (!loaded.length) {
        if (requestIdRef.current === myRequestId) setBusy(false);
        return toast.error(chosen.length === 1 ? "Could not load that atlas" : "Could not load those atlases");
      }
      const shortName = (id) => {
        const a = atlasOptions.find((x) => x.id === id);
        return a?.short || a?.name || id;
      };
      const lesionFile = await resolveLesionFile(lid);
      const { atlasBreakdowns, excludedAtlases, provenance: prov } = await resolveLesionAtlasMetrics({
        lesionFile,
        lesionVol,
        atlases: loaded.map((l) => ({ ...l, name: shortName(l.id) })),
      });
      if (requestIdRef.current !== myRequestId) return; // a newer request already landed

      const result = flattenOverlap(atlasBreakdowns);
      setRows(result);
      setProvenance(prov);
      // An atlas the lqtpy engine can't bridge (continuous / tracts4d kinds),
      // or one that wouldn't load, must say so, not silently add zero rows.
      const notes = [
        ...excludedAtlases.map((x) => `${x.name || shortName(x.id)}: ${x.reason}.`),
        ...failed.map((a) => `${a.short || a.name}: could not be loaded.`),
      ];
      if (notes.length) setNote(notes.join(" "));
      if (prov.fallback) {
        toast.warning("Using JS engine (fallback)", { description: prov.fallbackReason || "lqtpy unavailable" });
      }
      if (!result.length) {
        toast(chosen.length === 1 ? "No overlap with this atlas" : "No overlap with these atlases");
      } else {
        toast.success(`${result.length} regions overlapped`, { description: engineProvenanceLabel(prov) });
      }
    } catch (e) {
      if (requestIdRef.current !== myRequestId) return;
      toast.error("Overlap failed", { description: e?.message });
    } finally {
      if (requestIdRef.current === myRequestId) setBusy(false);
    }
  };

  const exportCSV = () => {
    if (!rows.length) return;
    const csv = overlapToCSV(rows);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadText(`overlap_${stamp}.csv`, csv);
    toast.success("Overlap CSV downloaded");
  };

  if (lesionLayers.length === 0) {
    return (
      <div className="text-[12px] text-subtle leading-relaxed" data-testid="overlap-empty">
        Load a lesion mask first to compute atlas overlap.
      </div>
    );
  }

  const voxelsLabel = rows.length && provenance?.engine === "lqtpy" ? "vox (atlas)" : "vox";

  return (
    <div className="space-y-2" data-testid="overlap-panel">
      {(!bare || isDevBuild()) && (
      <div className="flex items-center gap-2">
        {!bare && <span className="cap flex-1 text-subtle">Lesion ∩ atlas overlap</span>}
        {isDevBuild() && (
          <button
            onClick={() => setDevEngine(devEngine === "js" ? null : "js")}
            title="Dev only: force the JS engine instead of lqtpy, for side-by-side comparison"
            aria-pressed={devEngine === "js"}
            className={`btn-mini ${devEngine === "js" ? "!border-warn !bg-warn/15 !text-warn" : ""}`}
            data-testid="overlap-dev-engine-toggle"
          >
            <FlaskConical size={11} /> JS
          </button>
        )}
      </div>
      )}

      {/* Item 105: with exactly one lesion in scope (the per-lesion mount in
          LesionMasksSection passes just its own layer) the lesion picker is
          noise — the atlas row then stands alone. */}
      {lesionLayers.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="w-12 flex-shrink-0 text-[13px] text-muted-foreground">Lesion</span>
          <select value={lesionId} onChange={(e) => setLesionId(e.target.value)}
            className="field min-w-0 flex-1"
            data-testid="overlap-lesion-select">
            <option value="">— lesion —</option>
            {lesionLayers.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-[13px] text-muted-foreground">Atlases</div>
        <div className="flex flex-wrap gap-1.5" data-testid="overlap-atlases">
          {atlasOptions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => toggleAtlas(a.id)}
              aria-pressed={selected.has(a.id)}
              className={`h-[26px] rounded-[5px] border px-2.5 text-[12px] transition-colors ${activeToggleCls(selected.has(a.id))}`}
              title={a.name}
              data-testid={`overlap-atlas-${a.id}`}
            >
              {a.short || a.id}
            </button>
          ))}
        </div>
      </div>
      <button onClick={runOverlap} disabled={busy || selected.size === 0}
        className="btn w-full"
        data-testid="overlap-run">
        {busy ? "Computing…" : "Compute overlap"}
      </button>

      {note && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-warn" data-testid="overlap-note">
          {note}
        </div>
      )}

      {(rows.length > 0 || provenance) && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="flex-1">
            {rows.length > 0 ? `${rows.length} region${rows.length === 1 ? "" : "s"} overlapped` : ""}
          </span>
          {provenance && (
            <span className="truncate font-mono text-[11px] text-subtle" title={engineProvenanceLabel(provenance)} data-testid="overlap-provenance">
              {engineProvenanceLabel(provenance)}
            </span>
          )}
          <button onClick={exportCSV} disabled={!rows.length}
            className="btn-mini"
            title="Download the overlap table as CSV"
            data-testid="overlap-export">
            <Download size={11} /> CSV
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="max-h-44 overflow-y-auto thin-scroll" data-testid="overlap-table">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-subtle">
                <th className="cap py-1 pr-2 text-left">Atlas</th>
                <th className="cap py-1 pr-2 text-left">Region</th>
                <th className="cap px-1.5 py-1 text-right">{voxelsLabel}</th>
                <th className="cap px-1.5 py-1 text-right">% les</th>
                <th className="cap py-1 pl-1.5 text-right">% reg</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={i} className="border-t border-border text-foreground" data-testid={`overlap-row-${i}`}>
                  <td className="max-w-[72px] truncate py-[5px] pr-2 text-muted-foreground" title={r.atlasName}>{r.atlasName}</td>
                  <td className="max-w-[140px] truncate py-[5px] pr-2" title={r.regionName}>{r.regionName}</td>
                  <td className="px-1.5 py-[5px] text-right font-mono text-[11.5px] text-muted-foreground">{r.voxelCount}</td>
                  <td className="px-1.5 py-[5px] text-right font-mono text-[11.5px]">{r.percentOfLesion.toFixed(1)}</td>
                  <td className="py-[5px] pl-1.5 text-right font-mono text-[11.5px]">{r.percentOfRegion.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OverlapPanel;
