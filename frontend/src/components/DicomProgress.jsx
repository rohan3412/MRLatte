import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { dicomProgressView } from "@/lib/dicomProgress";

// The DICOM import's progress (lib/dicomProgress.js): four steps as four
// segments, the current one filling with real bytes where they exist and
// showing a moving stripe where they don't (conversion, opening), plus a line
// of detail (sizes, file count, seconds so far).
export function DicomProgress({ progress }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = progress?.stage === "convert" || progress?.stage === "open";
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [ticking, progress?.since]);

  const v = dicomProgressView(progress, now);
  if (!v) return null;
  return (
    <div className="space-y-1.5" data-testid="dicom-progress" data-stage={progress.stage} role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-foreground" data-testid="dicom-progress-title">
          {v.title}
          <span className="ml-1.5 font-normal text-subtle">step {v.step} of {v.of}</span>
        </span>
        {v.right && <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground" data-testid="dicom-progress-right">{v.right}</span>}
      </div>
      <div className="grid grid-cols-4 gap-1" aria-hidden="true">
        {v.steps.map((s) => (
          <div key={s.key} className="h-1.5 overflow-hidden rounded-full bg-panel-active" data-testid={`dicom-step-${s.key}`} data-state={s.state}>
            {s.state === "done" && <div className="h-full w-full bg-crema" />}
            {s.state === "active" && (s.fraction != null
              ? <div className="h-full bg-crema transition-[width] duration-200" style={{ width: `${s.fraction * 100}%` }} />
              : <div className="progress-indeterminate h-full" />)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1 text-[10.5px]" aria-hidden="true">
        {v.steps.map((s) => (
          <span key={s.key} className={`flex items-center gap-0.5 ${s.state === "todo" ? "text-subtle" : "text-muted-foreground"} ${s.state === "active" ? "font-medium text-foreground" : ""}`}>
            {s.state === "done" && <Check size={10} />}{s.label}
          </span>
        ))}
      </div>
      {v.detail && <div className="text-[11.5px] text-muted-foreground" data-testid="dicom-progress-detail">{v.detail}</div>}
    </div>
  );
}

export default DicomProgress;
