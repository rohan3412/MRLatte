import React from "react";
import {
  AlignVerticalSpaceAround, Box, Brush, Check, Eraser, FileText, Layers, Pencil, PencilRuler, Redo2, Save, Scissors,
  ScanEye, ShieldCheck, Sigma, Square, Undo2,
} from "lucide-react";

// The task toolbar's task sets (Preferences ▸ Sidebar ▸ Panels ▸ Task toolbar).
// Nothing here is new behaviour: each button presses the control the sidebar
// already has (by its test id), or calls the handler Dashboard gives the same
// button, so the two can never disagree. State shown here (the pen in use, what
// can be undone) comes from the same panel.

// The drawing panel's six label colours (DrawingPanel PEN_COLOURS).
const PEN_COLOURS = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#00FFFF", "#FF00FF"];

/** Press a control the sidebar renders (a disabled one ignores the click). */
export function press(testId, { reveal = false } = {}) {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) return false;
  el.click();
  if (reveal) setTimeout(() => el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 60);
  return true;
}

export const TASK_LABEL = { viewing: "Viewing", tracing: "Tracing", analysing: "Analysing" };
const TASK_ICON = { viewing: ScanEye, tracing: PencilRuler, analysing: Layers };

/** The button at the toolbar's left: the set in use; click to go to the other. */
export function ToolModeButton({ mode, target, onToggle }) {
  const Icon = TASK_ICON[mode];
  const next = mode === "viewing" ? target : "viewing";
  return (
    <button type="button" onClick={onToggle} disabled={!next}
      className="tb-b flex-shrink-0 disabled:opacity-50"
      title={next ? `${TASK_LABEL[mode]} tools. Switch to ${TASK_LABEL[next]}` : `${TASK_LABEL[mode]} tools. Draw or select a lesion or activation layer for a task set`}
      aria-label={`${TASK_LABEL[mode]} tools`} data-testid="tool-mode-toggle" data-mode={mode}>
      <Icon size={14} /><span>{TASK_LABEL[mode]}</span>
    </button>
  );
}

const Btn = ({ icon: Icon, label, testId, onClick, disabled, pressed, primary, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed}
    className={primary ? "btn-primary min-h-[28px] px-2.5 text-[12px] disabled:opacity-50" : "tb-b disabled:opacity-40"}
    title={title || label} data-testid={testId}>
    {Icon && <Icon size={14} />}<span>{label}</span>
  </button>
);

/** Tracing: the pen, brush, label colours, interpolate, undo/redo, Save mask, Done. */
export function TracingTools({ activeTool, brushMode, task }) {
  const t = task || {};
  return (
    <>
      <div className="tb-seg">
        <button type="button" className="tb-b" aria-pressed={activeTool === "pen"} onClick={() => press("pen-pen")}
          title="Pen / cutout" data-testid="task-pen"><Pencil size={14} /><Scissors size={12} className="opacity-60" /></button>
        <button type="button" className="tb-b" aria-pressed={activeTool === "brush"} onClick={() => press("pen-brush")}
          title="Brush / eraser" data-testid="task-brush"><Brush size={14} /><Eraser size={12} className="opacity-60" /></button>
      </div>
      <div className="tb-seg" role="group" aria-label="Brush reach">
        {["2D", "3D"].map((m) => (
          <button key={m} type="button" className="tb-i" aria-pressed={brushMode === m} onClick={() => press(`brush-mode-${m.toLowerCase()}`)}
            title={m === "3D" ? "3D sphere stamp across all slices" : "2D disc stamp on the current slice"} data-testid={`task-brush-${m.toLowerCase()}`}>
            {m === "3D" ? <Box size={14} /> : <Square size={14} />}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Label colour">
        {PEN_COLOURS.map((c, i) => (
          <button key={c} type="button" onClick={() => press(`pen-value-${i + 1}`)} aria-pressed={t.penValue === i + 1}
            title={`Label ${i + 1}`} data-testid={`task-pen-value-${i + 1}`}
            className={`keep-colours h-5 w-5 rounded-full ${t.penValue === i + 1 ? "ring-2 ring-foreground ring-offset-2 ring-offset-panel" : "opacity-70 hover:opacity-100"}`}
            style={{ background: c }} />
        ))}
      </div>
      <span className="tb-sep" />
      <Btn icon={AlignVerticalSpaceAround} label="Interpolate" testId="task-interpolate" disabled={!t.canInterpolate}
        title="Fill the gap between the last two slices you drew" onClick={() => press("draw-interpolate")} />
      <Btn icon={Undo2} label="Undo" testId="task-undo" disabled={!t.canUndo} onClick={() => press("drawing-undo")} />
      <Btn icon={Redo2} label="Redo" testId="task-redo" disabled={!t.canRedo} onClick={() => press("drawing-redo")} />
      <span className="flex-1" />
      <Btn icon={Save} label={t.saving ? "Saving…" : "Save mask"} testId="task-save" primary disabled={t.saving}
        title="Save the drawing as a named layer" onClick={() => press("drawing-save")} />
      <Btn icon={Check} label="Done" testId="task-done" title="Stop drawing" onClick={() => press("drawing-toggle")} />
    </>
  );
}

/** Analysing: for the lesion or activation layer selected in the inspector. */
export function AnalysingTools({ layer, onOpenReport }) {
  if (!layer) return null;
  if (layer.type === "lesion") {
    return (
      <>
        <Btn icon={ShieldCheck} label="Quality check" testId="task-qc" title="Check this lesion with LQTpy"
          onClick={() => press(`mask-qc-check-${layer.id}`)} />
        <Btn icon={Layers} label="Atlas overlap" testId="task-overlap" title="Opens the atlas overlap table for this lesion"
          onClick={() => press(`overlap-fold-${layer.id}-toggle`, { reveal: true })} />
        <span className="flex-1" />
        <Btn icon={FileText} label="Report…" testId="task-report" primary title="Opens the Report section with this lesion chosen"
          onClick={() => onOpenReport?.(layer.id)} />
      </>
    );
  }
  return (
    <>
      <Btn icon={Sigma} label="Clusters…" testId="task-clusters" title="Opens Cluster analysis with this map chosen"
        onClick={() => press(`clusters-open-${layer.id}`)} />
      <span className="flex-1" />
    </>
  );
}
