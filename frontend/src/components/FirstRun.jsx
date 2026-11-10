import React, { useState } from "react";
import { FileText, Laptop, Layers, Package, SlidersHorizontal, X } from "lucide-react";
import { PresetCards } from "@/components/PresetCards";
import { useTheme } from "@/hooks/use-theme";
import { usePreference } from "@/lib/preferences";

const VERSION = process.env.REACT_APP_VERSION || "";

// What's New for this version: the headlines of CHANGELOG.md's 0.6.0 section.
const WHATS_NEW = [
  { icon: Laptop, title: "MRLatte on the Mac", text: "Apple Silicon and Intel, the same offline app as on Windows." },
  { icon: FileText, title: "One place for a lesion's report", text: "Every lesion has a Report… button; operations whose module is missing say so, with an Install link." },
  { icon: SlidersHorizontal, title: "Preferences", text: "How the viewer opens, which sidebar sections show and in what order, notifications, transparency and a performance mode." },
  { icon: Layers, title: "Presets", text: "One choice sets up MRLatte for lesion tracing, lesion analysis, visual field work, functional maps or reading." },
  { icon: Package, title: "A smaller install", text: "SciPy and LQTpy install from the module store when you first need them, and a viewer-only installer can grow into the whole of MRLatte." },
];

/** Which steps to show: What's New once per version, the questionnaire once. */
export function firstRunSteps({ done, seenVersion, version }) {
  const steps = [];
  if (version && seenVersion !== version) steps.push("whatsNew");
  if (!done) steps.push("preset", "look");
  return steps;
}

/**
 * First run (owner, 5 Nov): What's New, which can be closed, then an animated
 * questionnaire over the blurred app that picks a preset and a few important
 * preferences. Every step, and the whole of it, can be skipped. Later
 * versions show only their What's New. The blur is one backdrop-filter over an
 * app that isn't moving, so it costs next to nothing.
 */
export function FirstRun() {
  const [done, setDone] = usePreference("firstRunDone");
  const [seenVersion, setSeenVersion] = usePreference("whatsNewVersion");
  const [steps] = useState(() => firstRunSteps({ done, seenVersion, version: VERSION }));
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState(1);
  const { appearance, setAppearance } = useTheme();
  const [radiological, setRadiological] = usePreference("startRadiological");
  const [effects, setEffects] = usePreference("visualEffects");
  const [performance, setPerformance] = usePreference("performanceMode");

  const step = steps[at];
  if (!step) return null;

  const finish = () => {
    if (VERSION) setSeenVersion(VERSION);
    setDone(true);
    setAt(steps.length);
  };
  const go = (d) => {
    if (steps[at] === "whatsNew" && VERSION) setSeenVersion(VERSION);
    if (at + d >= steps.length) { finish(); return; }
    setDir(d);
    setAt(Math.max(0, at + d));
  };

  const seg = (label, options, value, onChange) => (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} onClick={() => onChange(v)} aria-pressed={value === v}>{text}</button>
      ))}
    </div>
  );

  return (
    <div className="first-run fixed inset-0 z-[90] flex items-center justify-center p-6" role="dialog" aria-modal="true"
      aria-label={step === "whatsNew" ? `What's new in MRLatte ${VERSION}` : "Set up MRLatte"} data-testid="first-run">
      <div key={step} className={`first-run-card popover relative flex max-h-[88vh] w-full max-w-xl flex-col ${dir < 0 ? "from-left" : ""}`}>
        <button type="button" onClick={finish} className="icon-btn absolute right-2.5 top-2.5 h-7 w-7"
          aria-label="Skip all of this" title="Skip all of this" data-testid="first-run-skip-all"><X size={15} /></button>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-6 thin-scroll">
          {step === "whatsNew" && (
            <>
              <div className="cap text-subtle">MRLatte {VERSION}</div>
              <h2 className="mt-1 text-[20px] font-semibold text-foreground">What's new</h2>
              <ul className="mt-4 space-y-3.5">
                {WHATS_NEW.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-panel-active text-foreground"><Icon size={16} /></span>
                    <div>
                      <div className="text-[14px] font-medium text-foreground">{title}</div>
                      <div className="text-[13px] leading-snug text-muted-foreground">{text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === "preset" && (
            <>
              <h2 className="text-[20px] font-semibold text-foreground">What will you use MRLatte for?</h2>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                A preset shows the sidebar sections that job needs, in a useful order, and opens the viewer to suit
                it. Nothing is removed: anything hidden is one switch away in Preferences ▸ Sidebar, and you can
                change your preset there at any time.
              </p>
              <div className="mt-4"><PresetCards compact onPicked={() => go(1)} /></div>
            </>
          )}

          {step === "look" && (
            <>
              <h2 className="text-[20px] font-semibold text-foreground">A few more choices</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">All of these are in Preferences too.</p>
              <div className="mt-4 divide-y divide-border">
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1"><div className="text-[14px] font-medium">Look</div>
                    <div className="text-[12.5px] text-muted-foreground">System follows your computer's light or dark setting.</div></div>
                  {seg("Appearance", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], appearance, setAppearance)}
                </div>
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1"><div className="text-[14px] font-medium">Left and right</div>
                    <div className="text-[12.5px] text-muted-foreground">Radiological puts the patient's right on the left of the screen.</div></div>
                  {seg("Display convention", [[true, "R L"], [false, "L R"]], radiological, setRadiological)}
                </div>
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1"><div className="text-[14px] font-medium">Motion and effects</div>
                    <div className="text-[12.5px] text-muted-foreground">Effects: scans develop, layers bloom, checks ring the lesion. Performance: everything instant, no transparency.</div></div>
                  {seg("Motion and effects", [["on", "Effects"], ["perf", "Performance"]],
                    performance ? "perf" : effects ? "on" : "perf",
                    (v) => { setPerformance(v === "perf"); setEffects(v === "on"); })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3">
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => <span key={s} className={`h-1.5 w-1.5 rounded-full ${i === at ? "bg-foreground" : "bg-edge"}`} />)}
          </div>
          <div className="ml-auto flex gap-2">
            {at > 0 && <button type="button" className="btn" onClick={() => go(-1)}>Back</button>}
            {step === "preset" && <button type="button" className="btn" onClick={() => go(1)} data-testid="first-run-skip-step">Skip</button>}
            {step !== "preset" && (
              <button type="button" className="btn-primary" onClick={() => go(1)} data-testid="first-run-next">
                {at === steps.length - 1 ? "Start using MRLatte" : step === "whatsNew" && steps.length > 1 ? "Continue" : step === "whatsNew" ? "Close" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FirstRun;
