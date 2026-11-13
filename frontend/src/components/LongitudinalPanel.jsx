import React, { useEffect, useState } from "react";
import { GitCompareArrows, FileUp, AlertCircle, RefreshCw, Package } from "lucide-react";
import { longitudinalStatus, registerLongitudinal, LONGITUDINAL_MODULE_ID } from "@/lib/longitudinal";
import { useModules } from "@/hooks/use-modules";
import { toast } from "sonner";
import { uploadLesion, fetchCompare } from "@/lib/lesionMetrics";
import { useLqtpyFeature } from "@/hooks/useLqtpyFeature";

/**
 * LongitudinalPanel — pick a baseline + follow-up scan, register them on the
 * backend (SimpleITK), and hand the difference map back to the parent via
 * onDiffLoaded. The parent is responsible for adding the overlay to state so
 * it appears in the layer list and is cleared correctly on "Clear All".
 */
export const LongitudinalPanel = ({ onDiffLoaded }) => {
  const [baseline, setBaseline] = useState(null);
  const [followup, setFollowup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [backendAvailable, setBackendAvailable] = useState(null); // null = checking
  const [moduleMissing, setModuleMissing] = useState(false);       // backend up, SimpleITK not installed
  const { openStore } = useModules();

  const checkBackend = async () => {
    setBackendAvailable(null);
    const status = await longitudinalStatus();
    setModuleMissing(status === "module-missing");
    setBackendAvailable(status === "ok");
  };

  useEffect(() => { checkBackend(); }, []);

  const run = async () => {
    if (!baseline || !followup) return toast.error("Pick both scans");
    setBusy(true);
    const t = toast.loading("Registering & differencing… (may take a minute)");
    try {
      const { file, metrics: m } = await registerLongitudinal(baseline, followup);
      setMetrics(m);
      onDiffLoaded?.(file, { colormap: "warm", opacity: 0.7 });
      toast.success("Difference map loaded", { id: t });
    } catch (e) {
      toast.error("Comparison failed", { id: t, description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const pick =
    "flex items-center gap-2 cursor-pointer border border-dashed border-border bg-panel px-3 py-2 text-[12px] text-foreground hover:border-muted-foreground transition-colors";

  return (
    <div className="space-y-3" data-testid="longitudinal-panel">
      <div className="flex items-center gap-2 cap text-subtle">
        <GitCompareArrows size={11} /> baseline vs follow-up
      </div>

      {/* Backend status */}
      {backendAvailable === null && (
        <div className="font-mono text-[11px] text-muted-foreground animate-pulse">Checking backend…</div>
      )}
      {backendAvailable === false && moduleMissing && (
        <div className="border border-border p-3 space-y-2 rounded-lg" data-testid="long-module-missing">
          <div className="font-mono text-[11px] text-foreground">Longitudinal comparison needs the SimpleITK module.</div>
          <div className="text-[11.5px] text-muted-foreground leading-relaxed">
            Install it from the module store: a one-time download of about 19 MB from PyPI, checked against a pinned hash.
          </div>
          <div className="flex gap-3">
            {/* Opens the store at this module; installing happens there, like
                every other module. */}
            <button
              onClick={() => openStore(LONGITUDINAL_MODULE_ID)}
              className="flex items-center gap-1.5 text-[11px] font-mono text-foreground hover:text-warn transition-colors"
              data-testid="long-install-module"
            >
              <Package size={11} />Open module store
            </button>
            <button
              onClick={checkBackend}
              className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              data-testid="long-recheck"
            >
              <RefreshCw size={11} />Check again
            </button>
          </div>
        </div>
      )}
      {backendAvailable === false && !moduleMissing && (
        <div className="border border-warn/60 bg-warn/30 p-3 space-y-2 rounded-lg" data-testid="long-backend-unavailable">
          <div className="flex items-center gap-2 text-warn">
            <AlertCircle size={13} />
            <span className="font-mono text-[11px] font-medium">Backend not running</span>
          </div>
          <div className="text-[11.5px] text-muted-foreground leading-relaxed">
            Start the server to use longitudinal comparison:<br />
            <code className="text-foreground">cd backend &amp;&amp; uvicorn server:app --reload --port 8001</code>
          </div>
          <button
            onClick={checkBackend}
            className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            data-testid="long-retry"
          >
            <RefreshCw size={11} />Retry
          </button>
        </div>
      )}

      {backendAvailable && (
        <>
          <label className={pick} data-testid="long-baseline-label">
            <FileUp size={13} />
            <span className="truncate flex-1">{baseline ? baseline.name : "Select baseline scan"}</span>
            <input type="file" accept=".nii,.nii.gz,.mgz" className="hidden"
              data-testid="long-baseline"
              onChange={(e) => setBaseline(e.target.files?.[0] || null)} />
          </label>

          <label className={pick} data-testid="long-followup-label">
            <FileUp size={13} />
            <span className="truncate flex-1">{followup ? followup.name : "Select follow-up scan"}</span>
            <input type="file" accept=".nii,.nii.gz,.mgz" className="hidden"
              data-testid="long-followup"
              onChange={(e) => setFollowup(e.target.files?.[0] || null)} />
          </label>

          <button
            onClick={run}
            disabled={busy || !baseline || !followup}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12.5px] font-medium btn-primary disabled:opacity-50"
            data-testid="long-run"
          >
            <GitCompareArrows size={12} />{busy ? "Comparing…" : "Compare"}
          </button>

          {metrics && (
            <div className="border border-border bg-panel p-3 font-mono text-[11px] text-muted-foreground space-y-1 rounded-lg" data-testid="long-metrics">
              <div>changed voxels: <span className="text-foreground">{metrics.changedVoxelPct}%</span></div>
              {/* The backend sends Python's True/False. The follow-up is
                  always registered, so the metric is always there. */}
              <div>same grid: <span className="text-foreground">{metrics.sameGrid === "True" ? "yes" : "no"}</span></div>
              <div>reg. metric: <span className="text-foreground">{metrics.registrationMetric}</span></div>
              <div className="text-subtle">positive = follow-up &gt; baseline (warm overlay)</div>
            </div>
          )}
          <div className="text-[11.5px] text-subtle leading-relaxed">
            The follow-up is aligned to the baseline by moving and turning it (rigid registration, SimpleITK), also when both share a grid, since the head may have moved; it is never stretched, so real change stays visible. The difference map loads into Activation maps.
          </div>
        </>
      )}
      <LesionMaskCompare />
    </div>
  );
};

const cm3 = (mm3) => (mm3 / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });
// A region's percent damaged: one decimal below 10 %, so a small change doesn't read "0% → 0%".
const pct = (v) => (Math.abs(v) < 10 ? Number(v).toFixed(1) : Math.round(v));
const signed = (v, unit = "") => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;

/**
 * Two lesion masks of one patient (baseline and follow-up, or two drawings of
 * one lesion): what changed, by lqtpy.compare (lqtpy 0.8.0+). Needs no
 * registration: both masks must already be in the same space. Hidden on an
 * older lqtpy.
 */
function LesionMaskCompare() {
  const { modules } = useModules();
  const available = useLqtpyFeature("compare", modules);
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!available) return null;

  const run = async () => {
    setBusy(true);
    try {
      const [aId, bId] = [await uploadLesion(a), await uploadLesion(b)];
      setResult(await fetchCompare({ aLesionId: aId, bLesionId: bId }));
    } catch (e) {
      toast.error("Couldn't compare the masks", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };
  const pickFile = (setter) => (e) => { setter(e.target.files?.[0] || null); setResult(null); };
  const pick =
    "flex items-center gap-2 cursor-pointer border border-dashed border-border bg-panel px-3 py-2 text-[12px] text-foreground hover:border-muted-foreground transition-colors";
  const regions = (title, rows, testId) => rows?.length > 0 && (
    <div data-testid={testId}>
      <div className="text-subtle">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex justify-between gap-2">
          <span className="truncate text-foreground">{String(r.name).replace(/_/g, " ")}</span>
          <span className="shrink-0">{pct(r.a_pct)}% → {pct(r.b_pct)}%</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="mask-compare">
      <div className="flex items-center gap-2 cap text-subtle">
        <GitCompareArrows size={11} /> two lesion masks
      </div>
      <label className={pick}>
        <FileUp size={13} />
        <span className="truncate flex-1">{a ? a.name : "Select the first mask (baseline)"}</span>
        <input type="file" accept=".nii,.nii.gz" className="hidden" data-testid="mask-compare-a" onChange={pickFile(setA)} />
      </label>
      <label className={pick}>
        <FileUp size={13} />
        <span className="truncate flex-1">{b ? b.name : "Select the second mask (follow-up)"}</span>
        <input type="file" accept=".nii,.nii.gz" className="hidden" data-testid="mask-compare-b" onChange={pickFile(setB)} />
      </label>
      <button
        onClick={run}
        disabled={busy || !a || !b}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12.5px] font-medium btn disabled:opacity-50"
        data-testid="mask-compare-run"
      >
        <GitCompareArrows size={12} />{busy ? "Comparing…" : "Compare masks"}
      </button>
      {result && (
        <div className="border border-border bg-panel p-3 font-mono text-[11px] text-muted-foreground space-y-2 rounded-lg" data-testid="mask-compare-result">
          <div>
            <div>volume: <span className="text-foreground">{cm3(result.volume.a_mm3)} → {cm3(result.volume.b_mm3)} cm³</span>{" "}
              ({signed(result.volume.change_pct, "%")})</div>
            <div>overlap: <span className="text-foreground">Dice {result.overlap.dice.toFixed(2)}</span>, Jaccard {result.overlap.jaccard.toFixed(2)}</div>
            <div>centre moved: <span className="text-foreground">{result.centroid_shift_mm.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm</span></div>
          </div>
          {regions("newly damaged", result.regions?.gained, "mask-compare-gained")}
          {regions("no longer damaged", result.regions?.lost, "mask-compare-lost")}
          {regions("changed", result.regions?.changed, "mask-compare-changed")}
          {result.regions && !result.regions.gained?.length && !result.regions.lost?.length && !result.regions.changed?.length && (
            <div>regions: no change of {result.regions.min_change_pct ?? 5} points or more</div>
          )}
        </div>
      )}
      <div className="text-[11.5px] text-subtle leading-relaxed">
        Both masks must be in the same space (for example both in MNI). Regions are from the Desikan–Killiany–Tourville atlas. Compared by LQTpy.
      </div>
    </div>
  );
}

export default LongitudinalPanel;
