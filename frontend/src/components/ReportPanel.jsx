import React, { useEffect, useRef, useState } from "react";
import { FileText, Loader2, FileCode, FileType, Download, FlaskConical } from "lucide-react";
import { NVImage } from "@niivue/niivue";
import { describeTransform } from "@/lib/overlayTransform";
import { loadAtlasesForReading } from "@/lib/atlasLoad";
import {
  buildLesionReportModel, renderReportParagraph, renderReportText,
  engineProvenanceLabel, RETINOTOPY_ILLUSTRATIVE_NOTE, resolveReportFragments,
} from "@/lib/lesionReport";
import { buildTractReportModel } from "@/lib/htmlReport";
import { currentDrawingAsFile } from "@/lib/lesions";
import { isDevBuild, useLesionEngineDevOverride, getCapabilities } from "@/lib/lesionMetrics";
import { useReportDialog } from "@/hooks/useReportDialog";
import { activeToggleCls } from "@/lib/buttonVariants";
import { buildReport, buildSummaryReport, glanceText } from "@/lib/report";
import { lesionFigure, mapsFigure } from "@/lib/report/figures";
import { ReportDialog } from "@/components/ReportDialog";
import { ArtifactPickerDialog } from "@/components/ArtifactPickerDialog";
import { RunningIndicator } from "@/components/RunningIndicator";
import { LqtpyCredit } from "@/components/LqtpyCredit";
import { downloadText } from "@/lib/volumeAnalysis";
import { runSummary, summaryStatus, summaryResultUrl, cancelSummary } from "@/lib/summary";
import { useJobPoll } from "@/hooks/useJobPoll";
import { buildStageSteps } from "@/lib/jobStages";
import { useCapability, useModules, useModulesFor, useModuleStore } from "@/hooks/use-modules";
import { toInstallFor } from "@/lib/modules";
import { toast } from "sonner";

/**
 * The Report section (inbox 2 Nov): ONE place that makes a lesion's report.
 * It replaces two tools that overlapped: the per-lesion "One-click lesion
 * report" (volume, centre, atlas involvement, visual field; seconds) and
 * "LQTpy analysis" (the same plus tract disconnection and network mapping, as
 * a background job). The user ticks what to include; which engine runs follows
 * from that:
 *   - only atlas overlap / visual field  → made here in seconds (lqtpy metrics
 *     for the overlap, local maths for the visual field);
 *   - tract disconnection or network mapping ticked → the backend summary job
 *     (deps.py _run_summary_job), with progress at the bottom left.
 * Either way the report opens itself when ready, in the shared ReportDialog,
 * and can also be saved as PDF or text when it has a lesion model.
 *
 * Tract dissection and LNM keep their own reports in their sections; those
 * describe a run of that tool, not a lesion.
 */

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));
const over = (t) => (v) => v > t;
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const OPERATIONS = [
  ["overlap", "Atlas overlap"],
  ["retino", "Visual field"],
  ["dissect", "Tract disconnection"],
  ["lnm", "Network mapping"],
];
// Keys match the backend's status.json `stage` field.
const STAGE_STEPS = [
  { key: "prepare", label: "Preparing inputs" },
  { key: "dissect", label: "Tract disconnection" },
  { key: "lnm", label: "Network mapping" },
  { key: "render", label: "Rendering & packaging" },
  { key: "done", label: "Done" },
];
const DEFAULT_ATLASES = ["destrieux", "hcp1065"];
const STAGES_KEY = "mrlatte-report-stages";

function loadStages() {
  const fallback = { overlap: true, retino: true, dissect: true, lnm: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STAGES_KEY) || "null");
    return saved && typeof saved === "object" ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}

/** Still figures for a job's report: the lesion, the affected tracts and the
 * network, drawn over the base scan from the run's own maps (loaded
 * off-screen). Each is optional; one that can't be made is left out. */
async function buildJobFigures(result, lesionFile, base) {
  if (!base?.img) return {};
  const has = (rel) => (result.artifacts || []).some((a) => a.rel === rel);
  const load = async (rel) => {
    if (!has(rel)) return null;
    try {
      return await NVImage.loadFromUrl({
        url: summaryResultUrl(`/api/summary/result/${result.jobId}/${rel}`), name: rel.split("/").pop(),
      });
    } catch {
      return null;
    }
  };
  let lesion = null;
  try {
    if (lesionFile) lesion = await NVImage.loadFromFile({ file: lesionFile, name: lesionFile.name || "lesion.nii.gz" });
  } catch {
    lesion = null;
  }
  const [tracts, pos, neg] = await Promise.all([
    load("maps/affected_tracts.nii.gz"), load("maps/network_pos_bin.nii.gz"), load("maps/network_neg_bin.nii.gz"),
  ]);
  await yieldToMain();
  const figures = { lesion: lesion ? lesionFigure(base, lesion) : null };
  await yieldToMain();
  if (tracts) {
    figures.tracts = mapsFigure(base, [{ vol: tracts, test: over(0), color: "#f43f5e", alpha: 0.75 }], lesion,
      "Tracts with streamlines through the lesion (red); the lesion is outlined in white. Axial slices, neurological orientation (left is left).");
  }
  await yieldToMain();
  if (pos || neg) {
    figures.network = mapsFigure(base, [
      pos && { vol: pos, test: over(0.5), color: "#f97316", alpha: 0.75 },
      neg && { vol: neg, test: over(0.5), color: "#3b82f6", alpha: 0.75 },
    ].filter(Boolean), lesion,
    "The run's final network masks: voxels coupled to the lesion (orange) and anticorrelated with it (blue), after the specificity test when it ran; the lesion is outlined in white. Axial slices, neurological orientation (left is left).");
  }
  return figures;
}

/** A PDF of a lesion model: the short lead, the lesion figure, the top
 * regions per atlas and the visual-field findings. */
async function saveModelPdf(model, figure) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;
  const W = doc.internal.pageSize.getWidth() - margin * 2;
  const line = (txt, size = 10, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    for (const seg of doc.splitTextToSize(txt, W)) {
      if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
      doc.text(seg, margin, y);
      y += size + 4;
    }
  };
  line("MRLatte Lesion Report", 16, true);
  line(`Generated: ${model.generatedAt}`, 8);
  line(`Lesion: ${model.lesionName || "(unnamed)"}`, 10);
  const engineLine = engineProvenanceLabel(model.provenance);
  if (engineLine) line(engineLine, 8);
  y += 6;
  line(glanceText(model, { retinotopyFindings: model.retinotopyFindings }) || renderReportParagraph(model), 10);
  y += 6;
  if (figure) {
    const { width, height } = doc.getImageProperties(figure.src);
    const h = (W * height) / width;
    if (y + h > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
    doc.addImage(figure.src, "PNG", margin, y, W, h);
    y += h + 12;            // text is drawn on its baseline: clear the image first
    line(figure.caption, 8);
    y += 6;
  }
  // Top five regions per atlas (1% of the lesion or more); the full lists are
  // in the HTML and text exports.
  for (const b of model.atlasBreakdowns || []) {
    line(b.atlasName, 11, true);
    const shown = b.rows.filter((r) => r.percentOfLesion >= 1).slice(0, 5);
    for (const r of shown) {
      line(`  ${r.regionName} — ${r.percentOfLesion.toFixed(1)}% of lesion, ${r.percentOfRegion.toFixed(1)}% of region (${r.voxelCount} vox)`, 9);
    }
    const more = b.rows.length - shown.length;
    const s = more === 1 ? "" : "s";
    if (more) line(shown.length
      ? `  + ${more} more region${s} in the HTML and text exports.`
      : `  ${more} region${s}, each under 1% of the lesion: listed in the HTML and text exports.`, 8);
    y += 4;
  }
  const ret = model.retinotopyFindings || [];
  if (ret.length) {
    line("Retinotopy", 11, true);
    for (const f of ret) line(`  ${f.name} (${f.kind}) — ${f.summary}`, 9);
    if (ret.some((f) => f.illustrative)) line(`  ${RETINOTOPY_ILLUSTRATIVE_NOTE}`, 8);
    for (const a of [...new Set(ret.filter((f) => f.attribution).map((f) => f.attribution))]) {
      line(`  Source: ${a}`, 8);
    }
  }
  doc.save(`lesion_report_${stamp()}.pdf`);
}

/**
 * Props:
 *   lesionId / onLesionChange - the chosen lesion (Dashboard owns it, so a
 *                               lesion card's "Report" button can pick it)
 *   lesionLayers              - [{ id, name, transform }]
 *   standardAtlases           - installed atlases
 *   visibleAtlasIds           - atlases currently shown (default selection)
 *   retinotopyLayers          - [{ id, name, kind, illustrative, attribution }]
 *   retinoVolume              - (id) => NVImage | null, on or off screen
 *   getVfMap2dDataUrl         - (lesionId) => Promise<dataURL|null>, cortical map
 *   getWmVfMap2dDataUrl       - (lesionId) => Promise<dataURL|null>, white-matter map
 */
export const ReportPanel = ({
  viewerRef, lesionId: lesionIdProp, onLesionChange, lesionLayers = [],
  standardAtlases = [], visibleAtlasIds = [],
  ensureAtlasRegions, ensureAtlasLoaded, userFileCache,
  retinotopyLayers = [], retinoVolume, getVfMap2dDataUrl, getWmVfMap2dDataUrl,
}) => {
  const lesionLayer = lesionLayers.find((l) => l.id === lesionIdProp) || lesionLayers[0] || null;
  const lesionId = lesionLayer?.id || "";
  const lesionName = lesionLayer?.name || lesionId || "lesion";

  const [name, setName] = useState("");
  const [stages, setStages] = useState(loadStages);
  // null = not chosen yet: the atlases on screen, else the usual pair. Worked
  // out on each render, since the section mounts before the atlas list loads.
  const [pickedAtlases, setPickedAtlases] = useState(null);
  const selAtlases = pickedAtlases ?? (() => {
    const installed = (id) => standardAtlases.some((a) => a.id === id);
    const visible = visibleAtlasIds.filter(installed);
    return new Set(visible.length ? visible : DEFAULT_ATLASES.filter(installed));
  })();
  const [quickBusy, setQuickBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  // The finished report: { kind: "quick"|"job", lesionId, name, model, jobId }.
  const [result, setResult] = useState(null);
  const [reportHtml, setReportHtml] = useState(null);
  const [artifactPickerOpen, setArtifactPickerOpen] = useState(false);
  const [engineVersion, setEngineVersion] = useState(null);
  const [devEngine, setDevEngine] = useLesionEngineDevOverride();
  const { reportOpen, setReportOpen, openReport } = useReportDialog();
  // §6 stale-response guard for the quick path: a second click while one is
  // building must not let the older one land on top.
  const requestIdRef = useRef(0);
  const lesionFileRef = useRef(null);
  // What arrives after a job's report first opens (lqtpy's sections, the
  // figures); the report is rebuilt as each lands.
  const extrasRef = useRef({ frags: null, figures: null });
  const vfMapRef = useRef(null);

  useEffect(() => {
    getCapabilities().then((c) => setEngineVersion(c?.version || null)).catch(() => {});
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STAGES_KEY, JSON.stringify(stages)); } catch { /* per-viewer convenience only */ }
  }, [stages]);

  // An operation whose module isn't installed is greyed out with an Install
  // link and never sent. Unknown (still loading) counts as available.
  const unavailable = {
    dissect: useCapability("dissect") === false,
    lnm: useCapability("lnm") === false,
  };
  const modulesFor = { dissect: useModulesFor("dissect"), lnm: useModulesFor("lnm") };
  const { openStore } = useModuleStore();
  const { modules: allModules } = useModules();
  const moduleToInstall = (k) => {
    const mods = modulesFor[k] || [];
    return toInstallFor(mods, allModules)[0] || mods[0] || null;
  };
  const eff = Object.fromEntries(Object.entries(stages).map(([k, on]) => [k, on && !unavailable[k]]));
  const needsJob = eff.dissect || eff.lnm;
  const nothingChosen = !eff.overlap && !eff.retino && !needsJob;

  const toggleStage = (k) => setStages((p) => ({ ...p, [k]: !p[k] }));
  const toggleAtlas = (id) => {
    const n = new Set(selAtlases);
    n.has(id) ? n.delete(id) : n.add(id);
    setPickedAtlases(n);
  };

  const resolveLesionFile = async () => {
    const cached = userFileCache?.current?.[lesionId]?.file;
    if (cached) return cached;
    // Drawn (not uploaded) lesions: the in-memory drawing.
    return currentDrawingAsFile(viewerRef, `${lesionName}.nii.gz`);
  };

  const lesionFigureFor = (id) => {
    try {
      const viewer = viewerRef.current;
      return lesionFigure(viewer?.getBaseVolume?.(), viewer?.getVolume?.(id));
    } catch {
      return null;
    }
  };

  // ---- Background job (tract disconnection / network mapping) ----
  const buildJobHtml = (r, frags, figures) => buildSummaryReport({
    lesionName: r.lesion_name || r.name,
    lesionModel: r.overlap_model || null,
    reportFragments: frags,
    tractModel: r.dissect_info ? buildTractReportModel(r.dissect_info, r.lesion_name) : null,
    lnmResult: r.lnm_info || null,
    extraImages: [vfMapRef.current && { label: "Visual-field map", dot: "#7c3aed", imgUrl: vfMapRef.current }].filter(Boolean),
    figures: figures || {},
    retino: r.retino || null,
  });

  const { job, setJob, busy: jobActive, cancelling, cancel: handleCancel } = useJobPoll({
    statusFn: summaryStatus,
    cancelFn: cancelSummary,
    notifyLabel: "The report",
    keepDoneState: true,
    onCancelled: () => toast.info("Report cancelled"),
    onError: (s) => toast.error("Report failed", { description: s.error }),
    onDone: (s, curJob) => {
      // `name` is the one captured when the job started, so a rename typed
      // afterwards doesn't relabel a finished run.
      const files = { ...(s.files || {}), jobId: curJob.jobId, name: curJob.name };
      const model = files.overlap_model
        ? { lesionName: files.lesion_name || curJob.name, generatedAt: new Date().toISOString(), ...files.overlap_model }
        : null;
      setResult({ kind: "job", lesionId: curJob.lesionId, name: curJob.name, model, jobId: curJob.jobId, files });
      extrasRef.current = { frags: null, figures: null };
      const rebuild = () => setReportHtml(buildJobHtml(files, extrasRef.current.frags, extrasRef.current.figures));
      rebuild();
      openReport();
      toast.success("Report ready", { description: curJob.name });
      if (files.overlap_model && lesionFileRef.current) {
        const atlasIds = (files.overlap_model.atlasBreakdowns || []).map((b) => b.atlasId);
        resolveReportFragments({ lesionFile: lesionFileRef.current, atlasIds, threshold: files.overlap_model.provenance?.threshold })
          .then((frags) => { extrasRef.current.frags = frags; rebuild(); });
      }
      buildJobFigures(files, lesionFileRef.current, viewerRef.current?.getBaseVolume?.())
        .catch(() => ({}))
        .then((figures) => { extrasRef.current.figures = figures; rebuild(); });
    },
  });

  const runJob = async (reportName) => {
    setStarting(true);
    // Show the progress card before the async work below, so nothing looks frozen.
    setJob({ jobId: null, stage: "prepare", message: "Preparing inputs…", progress: 0, done: false, name: reportName, lesionId });
    try {
      const lesionFile = await resolveLesionFile();
      if (!lesionFile) {
        toast.error("Lesion file unavailable", { description: "Upload or draw a lesion first." });
        setJob(null);
        return;
      }
      lesionFileRef.current = lesionFile;
      await yieldToMain();
      vfMapRef.current = null;
      if (eff.retino) {
        try { vfMapRef.current = (await getVfMap2dDataUrl?.(lesionId)) ?? null; } catch { /* best-effort */ }
      }
      const { job_id } = await runSummary(lesionFile, {
        name: reportName,
        stages: { overlap: eff.overlap, dissect: eff.dissect, retino: eff.retino, lnm: eff.lnm },
        atlas_ids: eff.overlap ? [...selAtlases] : [],
      });
      setJob({ jobId: job_id, stage: "queued", message: "Queued…", progress: 0, done: false, name: reportName, lesionId });
    } catch (e) {
      toast.error("Could not start the report", { description: e?.message });
      setJob(null);
    } finally {
      setStarting(false);
    }
  };

  // ---- Quick report (atlas overlap / visual field only) ----
  const runQuick = async (reportName) => {
    const lesionVol = viewerRef.current?.getVolume?.(lesionId);
    if (!lesionVol?.img) return toast.error("Lesion volume unavailable");
    const myRequestId = ++requestIdRef.current;
    setQuickBusy(true);
    try {
      const atlases = eff.overlap
        ? await loadAtlasesForReading(standardAtlases.filter((a) => selAtlases.has(a.id)),
          { viewerRef, ensureAtlasLoaded, ensureRegions: ensureAtlasRegions })
        : [];
      // Visual-field maps already loaded (never force-loaded here, so a
      // missing white-matter map is skipped, not a 404).
      const retinotopy = [];
      if (eff.retino) {
        for (const r of retinotopyLayers) {
          const vol = retinoVolume ? retinoVolume(r.id) : viewerRef.current?.getVolume?.(r.id);
          if (vol?.img) retinotopy.push({ ...r, vol });
        }
      }
      // A lesion moved by hand is analysed where it was moved to; say so.
      const adjusted = describeTransform(lesionLayer?.transform);
      const shownName = reportName + (adjusted ? ` (position adjusted by hand: ${adjusted})` : "");
      const lesionFile = await resolveLesionFile();
      lesionFileRef.current = lesionFile;
      const model = await buildLesionReportModel({ lesionName: shownName, lesionVol, lesionFile, atlases, retinotopy });
      if (requestIdRef.current !== myRequestId) return;
      if (model.provenance?.fallback) {
        toast.warning("Report used the JS engine (fallback)", { description: model.provenance.fallbackReason || "lqtpy unavailable" });
      }
      const vfMap2dDataUrl = eff.retino ? (await getVfMap2dDataUrl?.(lesionId)) ?? null : null;
      const wmVfMap2dDataUrl = eff.retino ? (await getWmVfMap2dDataUrl?.(lesionId)) ?? null : null;
      // lqtpy's extra sections fail soft: a slow fetch costs one quiet note.
      const reportFragments = await resolveReportFragments({
        lesionFile, atlasIds: (model.atlasBreakdowns || []).map((b) => b.atlasId), threshold: model.provenance?.threshold,
      });
      if (requestIdRef.current !== myRequestId) return;
      setReportHtml(buildReport("lesion", {
        ...model, vfMap2dDataUrl, wmVfMap2dDataUrl, reportFragments, lesionFigure: lesionFigureFor(lesionId),
      }));
      setResult({ kind: "quick", lesionId, name: reportName, model });
      openReport();
    } catch (e) {
      if (requestIdRef.current !== myRequestId) return;
      // A 4xx (an empty lesion) or a real 5xx is a failure, not a fallback.
      setError(e?.message || "Report failed");
      toast.error("Report failed", { description: e?.message });
    } finally {
      if (requestIdRef.current === myRequestId) setQuickBusy(false);
    }
  };

  const create = () => {
    if (!lesionId) return toast.error("No lesion layer");
    setError(null);
    setResult(null);
    setReportHtml(null);
    const reportName = name.trim() || lesionName;
    return needsJob ? runJob(reportName) : runQuick(reportName);
  };

  if (lesionLayers.length === 0) {
    return (
      <div className="py-1 text-[12px] leading-relaxed text-subtle" data-testid="report-empty">
        Load or draw a lesion mask first. Its report covers atlas overlap, the visual field, and, with
        their modules, tract disconnection and network mapping.
      </div>
    );
  }

  const busy = quickBusy || starting || jobActive;
  const resultLesion = result && lesionLayers.find((l) => l.id === result.lesionId);

  return (
    <div className="space-y-3" data-testid="report-panel">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-12 flex-shrink-0 text-[13px] text-muted-foreground">Lesion</span>
          <select
            value={lesionId}
            onChange={(e) => onLesionChange?.(e.target.value)}
            className="field min-w-0 flex-1"
            data-testid="report-lesion-select"
          >
            {lesionLayers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {isDevBuild() && (
            <button
              onClick={() => setDevEngine(devEngine === "js" ? null : "js")}
              title="Dev only: force the JS engine instead of lqtpy, for side-by-side comparison"
              aria-pressed={devEngine === "js"}
              className={`btn-mini ${devEngine === "js" ? "!border-warn !bg-warn/15 !text-warn" : ""}`}
              data-testid="report-dev-engine-toggle"
            >
              <FlaskConical size={11} /> JS
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 flex-shrink-0 text-[13px] text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lesionName}
            className="field min-w-0 flex-1"
            data-testid="report-name"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="cap text-subtle">Include</div>
        {OPERATIONS.map(([k, label]) => {
          const missing = unavailable[k] ? moduleToInstall(k) : null;
          return (
            <div key={k} className="flex items-center gap-2">
              <label
                className={`flex items-center gap-2 text-[13px] ${unavailable[k] ? "cursor-not-allowed text-muted-foreground opacity-60" : "cursor-pointer text-foreground"}`}
                title={unavailable[k] ? `${label} needs ${missing?.name || "a module"}, which is not installed.` : undefined}
              >
                <input type="checkbox" checked={eff[k]} disabled={unavailable[k]} onChange={() => toggleStage(k)}
                  className="accent-crema" data-testid={`report-stage-${k}`} />
                {label}
              </label>
              {missing && (
                <button
                  type="button"
                  onClick={() => openStore(missing.id)}
                  className="text-[12px] text-subtle underline transition-colors hover:text-foreground"
                  data-testid={`report-install-${k}`}
                >
                  Install…
                </button>
              )}
            </div>
          );
        })}
      </div>

      {eff.overlap && (
        <div className="space-y-1.5">
          <div className="cap text-subtle">Atlases</div>
          <div className="flex flex-wrap gap-1.5">
            {standardAtlases.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAtlas(a.id)}
                aria-pressed={selAtlases.has(a.id)}
                className={`h-[26px] rounded-[5px] border px-2.5 text-[12px] transition-colors ${activeToggleCls(selAtlases.has(a.id))}`}
                title={a.name}
                data-testid={`report-atlas-${a.id}`}
              >
                {a.short || a.id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <button
          onClick={create}
          disabled={busy || nothingChosen}
          className="btn-primary flex w-full gap-2 px-3 py-2"
          data-testid="report-create"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          {jobActive ? "Running…" : busy ? "Creating…" : "Create report"}
        </button>
        <p className="text-[12px] leading-relaxed text-subtle" data-testid="report-hint">
          {nothingChosen
            ? "Tick at least one thing to include."
            : needsJob
              ? "Tract disconnection and network mapping take a few minutes. Progress shows at the bottom left, with Cancel. The report opens when it's ready."
              : "Ready in a few seconds. The report opens when it's ready."}
        </p>
        <LqtpyCredit version={engineVersion} prefix="Runs on " />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[12px] leading-relaxed text-destructive" data-testid="report-error">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2 border-t border-border pt-3" data-testid="report-result">
          <div className="flex items-baseline gap-2">
            <span className="cap text-subtle">Last report</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={result.name}>
              {result.name}{resultLesion && resultLesion.name !== result.name ? ` · ${resultLesion.name}` : ""}
            </span>
          </div>
          {result.model?.excludedAtlases?.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-2 py-1.5 text-[12px] leading-relaxed text-warn" data-testid="report-excluded-atlases">
              {result.model.excludedAtlases.map((a) => a.name).join(", ")}: {result.model.excludedAtlases[0].reason}.
            </div>
          )}
          {result.model?.provenance && (
            <div className="px-0.5 font-mono text-[11px] text-subtle" data-testid="report-provenance">
              {engineProvenanceLabel(result.model.provenance)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={openReport} disabled={!reportHtml} className="btn gap-1.5 px-2" data-testid="report-open">
              <FileCode size={11} />Open report
            </button>
            {result.kind === "job" ? (
              <button onClick={() => setArtifactPickerOpen(true)} disabled={!result.jobId} className="btn gap-1.5 px-2"
                title="Download the run's maps and tables" data-testid="report-data">
                <Download size={11} />Data…
              </button>
            ) : <span />}
            {result.model && (
              <>
                <button onClick={() => saveModelPdf(result.model, lesionFigureFor(result.lesionId))} className="btn gap-1.5 px-2" data-testid="report-export-pdf">
                  <FileType size={11} />PDF
                </button>
                <button onClick={() => downloadText(`lesion_report_${stamp()}.txt`, renderReportText(result.model), "text/plain")}
                  className="btn gap-1.5 px-2" data-testid="report-export-txt">
                  <Download size={11} />Text
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <RunningIndicator
        title="Report"
        active={!!job}
        done={!!job?.done}
        error={job?.error}
        message={job?.message}
        onCancel={handleCancel}
        cancelling={cancelling}
        onDismiss={() => setJob(null)}
        progress={job?.progress}
        steps={buildStageSteps(
          STAGE_STEPS.filter((s) => s.key === "prepare" || s.key === "render" || s.key === "done" || eff[s.key]),
          job,
        )}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Report"
        subject={result?.name}
        html={reportHtml}
        filename={`report_${stamp()}.html`}
      />
      <ArtifactPickerDialog open={artifactPickerOpen} onOpenChange={setArtifactPickerOpen} jobId={result?.jobId} />
    </div>
  );
};

export default ReportPanel;
