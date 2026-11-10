import React, { useState } from "react";
import { Bell, Gauge, Info, Layers, LayoutList, PencilRuler, ScanEye, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { EditableNumber } from "@/components/ui/editable-number";
import { SectionOrderList } from "@/components/SectionOrderList";
import { PresetCards } from "@/components/PresetCards";
import { useTheme } from "@/hooks/use-theme";
import { usePreference, HEADER_BUTTON_IDS } from "@/lib/preferences";
import { layoutReducer } from "@/lib/panelLayout";

const LOOKS = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
// The toolbar's own layouts (Dashboard SLICE_MODES) and crosshair colours.
const LAYOUTS = [["multiplanar", "Multiplanar + 3D"], ["render", "3D render"], ["axial", "Axial"],
  ["coronal", "Coronal"], ["sagittal", "Sagittal"], ["mosaic", "Mosaic"]];
const CROSSHAIR_COLOURS = [["white", "bg-white"], ["red", "bg-red-500"], ["yellow", "bg-yellow-400"],
  ["cyan", "bg-cyan-400"], ["green", "bg-green-400"]];
const IDLE_SECONDS = [10, 20, 30, 60, 120, 300];

// One row: what it does on the left, the control on the right.
const Row = ({ title, hint, children }) => (
  <div className="flex items-start gap-3 py-2.5">
    <div className="min-w-0 flex-1">
      <div className="text-[13.5px] font-medium text-foreground">{title}</div>
      {hint && <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
    <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">{children}</div>
  </div>
);

const HEADER_BUTTON_NAMES = {
  modules: "Module store", sections: "Collapse all sections", theme: "Light / dark mode",
  search: "Search", screenshot: "Screenshot", focus: "Focus mode", shortcuts: "Keyboard shortcuts",
  preferences: "Preferences", sidebar: "Collapse sidebar",
};

const Group = ({ title, children }) => (
  <section className="pt-3 first:pt-0">
    {title && <h3 className="cap text-subtle">{title}</h3>}
    <div className="divide-y divide-border">{children}</div>
  </section>
);

// A segment of named options bound to one preference.
const Seg = ({ label, options, value, onChange, testId }) => (
  <div className="seg" role="group" aria-label={label}>
    {options.map(([id, text, title]) => (
      <button key={String(id)} onClick={() => onChange(id)} aria-pressed={value === id} title={title}
        data-testid={`${testId}-${id}`}>{text}</button>
    ))}
  </div>
);

const PAGES = [
  { id: "general", title: "General", icon: SlidersHorizontal },
  { id: "presets", title: "Presets", icon: Layers },
  { id: "viewer", title: "Viewer", icon: ScanEye },
  { id: "drawing", title: "Drawing", icon: PencilRuler },
  { id: "sidebar", title: "Sidebar", icon: LayoutList },
  { id: "notifications", title: "Notifications", icon: Bell },
  { id: "performance", title: "Performance", icon: Gauge },
];

// `now`: this session's left/right and background, which live in Dashboard
// (they used to be toolbar buttons; owner, 5 Nov).
export const PreferencesDialog = ({ open, onOpenChange, now }) => {
  const [page, setPage] = useState("general");
  const { appearance, setAppearance } = useTheme();
  const [hideUnavailable, setHideUnavailable] = usePreference("hideUnavailableSections");
  const [headerButtons, setHeaderButtons] = usePreference("headerButtons");
  const [radiological, setRadiological] = usePreference("startRadiological");
  const [layout, setLayout] = usePreference("startLayout");
  const [white, setWhite] = usePreference("startWhiteBackground");
  const [crosshair, setCrosshair] = usePreference("startCrosshair");
  const [colour, setColour] = usePreference("crosshairColor");
  const [width, setWidth] = usePreference("crosshairWidth");
  const [idleQc, setIdleQc] = usePreference("idleQc");
  const [idleSeconds, setIdleSeconds] = usePreference("idleQcSeconds");
  const [effects, setEffects] = usePreference("visualEffects");
  const [transparency, setTransparency] = usePreference("transparency");
  const [performance, setPerformance] = usePreference("performanceMode");
  const [notify, setNotify] = usePreference("jobNotifications");
  const [screenshotAsk, setScreenshotAsk] = usePreference("screenshotAsk");
  const [inspector, setInspector] = usePreference("inspectorPanel");
  const [uiScale, setUiScale] = usePreference("uiScale");
  const [density, setDensity] = usePreference("density");
  const [lowRes, setLowRes] = usePreference("lowResWhileRotating");
  const [perfInfo, setPerfInfo] = useState(false);
  const [readout, setReadout] = usePreference("readout");
  const [taskToolbar, setTaskToolbar] = usePreference("taskToolbar");
  const [movable, setMovable] = usePreference("movablePanels");
  const [movableInspector, setMovableInspector] = usePreference("movableInspector");
  const [movableToolbar, setMovableToolbar] = usePreference("movableToolbar");
  const [movableReadout, setMovableReadout] = usePreference("movableReadout");
  const [movableSections, setMovableSections] = usePreference("movableSections");
  const [layouts, setLayouts] = usePreference("panelLayouts");
  const [activePreset] = usePreference("activePreset");
  const presetKey = activePreset || "default";

  const body = {
    general: (
      <Group>
        <Row title="Look" hint="System follows your operating system's light or dark setting, also when it changes.">
          <Seg label="Appearance" options={LOOKS} value={appearance} onChange={setAppearance} testId="pref-appearance" />
        </Row>
        {now && (
          <Row title="Left and right, now" hint="Radiological (R L) puts the patient's right on the screen's left. How MRLatte opens is on the Viewer page.">
            <Seg label="Display convention now" value={now.radiological} onChange={now.setRadiological} testId="now-convention"
              options={[[true, "R L", "Radiological"], [false, "L R", "Neurological"]]} />
          </Row>
        )}
        {now && (
          <Row title="Viewer background, now" hint="White is for figures and screenshots.">
            <Seg label="Viewer background now" value={now.whiteBackground} onChange={now.setWhiteBackground} testId="now-background"
              options={[[false, "Black"], [true, "White"]]} />
          </Row>
        )}
        <Row title="Text size" hint={window.mrlatte ? "The whole interface, the viewer included." : "In the browser, use the browser's own zoom (Ctrl + and Ctrl -)."}>
          <Seg label="Text size" value={uiScale} onChange={setUiScale} testId="pref-ui-scale"
            options={[[90, "90%"], [100, "100%"], [110, "110%"], [125, "125%"]]} />
        </Row>
        <Row title="Spacing" hint="Compact fits more sidebar sections and layers on screen.">
          <Seg label="Spacing" value={density} onChange={setDensity} testId="pref-density"
            options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} />
        </Row>
        <Row title="Screenshots" hint="Saved straight to Pictures\MRLatte, or asked each time.">
          <Seg label="Screenshots" value={screenshotAsk} onChange={setScreenshotAsk} testId="pref-screenshot"
            options={[[false, "Save to Pictures"], [true, "Ask where"]]} />
        </Row>
        <Row title="Transparency"
          hint={performance ? "Off while Performance mode is on."
            : "Lets the desktop show through the top bar, sidebar and menus. The viewer stays opaque."}>
          <div className={`flex w-40 items-center gap-2 ${performance ? "opacity-50" : ""}`}>
            <Slider value={[transparency]} min={0} max={80} step={5} disabled={performance}
              onValueChange={(v) => setTransparency(v[0])} className="flex-1" aria-label="Transparency"
              data-testid="pref-transparency" />
            <EditableNumber value={transparency} min={0} max={80} integer step={5} onCommit={setTransparency}
              label="Transparency" className="w-9 text-right font-mono text-[11.5px] text-foreground">{transparency}%</EditableNumber>
          </div>
        </Row>
      </Group>
    ),
    presets: (
      <>
        <div className="pb-3 text-[12.5px] leading-snug text-muted-foreground">
          A preset sets which sidebar sections show, in what order, and how the viewer opens. Everything it sets
          can still be changed one by one afterwards, on the Viewer and Sidebar pages.
        </div>
        <PresetCards />
      </>
    ),
    viewer: (
      <>
      <Group title="When MRLatte opens">
        <Row title="Left and right" hint="Radiological shows the patient's right on the left of the screen; neurological, on the right.">
          <Seg label="Display convention" value={radiological} onChange={setRadiological} testId="pref-convention"
            options={[[true, "R L", "Radiological"], [false, "L R", "Neurological"]]} />
        </Row>
        <Row title="Layout">
          <select value={layout} onChange={(e) => setLayout(e.target.value)} className="field" aria-label="Layout at start"
            data-testid="pref-layout">
            {LAYOUTS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </Row>
        <Row title="Viewer background" hint="White is for figures and screenshots.">
          <Seg label="Viewer background" value={white} onChange={setWhite} testId="pref-background"
            options={[[false, "Black"], [true, "White"]]} />
        </Row>
        <Row title="Crosshair">
          <Switch checked={crosshair} onCheckedChange={setCrosshair} label="Show the crosshair" testId="pref-crosshair" />
        </Row>
        {crosshair && (
          <Row title="Crosshair colour and thickness">
            <div className="flex gap-1.5" role="group" aria-label="Crosshair colour">
              {CROSSHAIR_COLOURS.map(([id, bg]) => (
                <button key={id} onClick={() => setColour(id)} aria-pressed={colour === id} title={id} aria-label={id}
                  className={`keep-colours h-5 w-5 rounded-full ${bg} ${colour === id ? "ring-2 ring-foreground ring-offset-2 ring-offset-panel" : "opacity-70"}`}
                  data-testid={`pref-crosshair-colour-${id}`} />
              ))}
            </div>
            <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className="field w-14"
              aria-label="Crosshair thickness" data-testid="pref-crosshair-width">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Row>
        )}
      </Group>
      <Group title="While you work">
        <Row title="Readout" hint="Where the crosshair's coordinates, values and region names show. A chip in the viewer's corner, or a small tag beside the crosshair on the tile you are working in.">
          <Seg label="Readout" value={readout} onChange={setReadout} testId="pref-readout"
            options={[["chip", "Corner chip"], ["beside", "Beside the crosshair"]]} />
        </Row>
      </Group>
      </>
    ),
    drawing: (
      <Group>
        <Row title="Check the drawing after a pause"
          hint="Runs LQTpy's quality check in the background when you stop drawing, and shows what it finds on the viewer.">
          <Switch checked={idleQc} onCheckedChange={setIdleQc} label="Check the drawing after a pause" testId="pref-idle-qc" />
        </Row>
        {idleQc && (
          <Row title="Pause before the check">
            <select value={idleSeconds} onChange={(e) => setIdleSeconds(Number(e.target.value))} className="field"
              aria-label="Pause before the check" data-testid="pref-idle-seconds">
              {IDLE_SECONDS.map((s) => <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>)}
            </select>
          </Row>
        )}
      </Group>
    ),
    sidebar: (
      <>
        <Group>
          <Row title="Hide sections that need a module"
            hint="Leave out the sidebar sections whose module isn't installed, instead of greying them out. Install a module from the module store and its section comes back.">
            <Switch checked={hideUnavailable} onCheckedChange={setHideUnavailable}
              label="Hide sections that need a module" testId="pref-hide-unavailable" />
          </Row>
          <Row title="Layer settings in a panel on the right"
            hint="The sidebar keeps one line per layer; clicking a layer's name opens all its settings in a panel beside the viewer. Off: each layer's settings unfold in the sidebar, as before.">
            <Switch checked={inspector} onCheckedChange={setInspector} label="Layer settings in a panel on the right" testId="pref-inspector" />
          </Row>
        </Group>
        <Group title="Header buttons">
          <div className="py-2.5">
            <div className="text-[12.5px] leading-snug text-muted-foreground">The buttons in the sidebar's top row.</div>
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pref-header-buttons">
              {HEADER_BUTTON_IDS.map((id) => {
                const on = headerButtons.includes(id);
                return (
                  <button key={id} type="button" aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      on ? "border-edge bg-panel-active text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setHeaderButtons(on ? headerButtons.filter((x) => x !== id) : [...headerButtons, id])}
                    data-testid={`pref-header-${id}`}>
                    {HEADER_BUTTON_NAMES[id]}
                  </button>
                );
              })}
            </div>
          </div>
        </Group>
        <Group title="Panels">
          <Row title="Task toolbar"
            hint="A button at the left of the toolbar swaps the Viewing tools for the tools of the task at hand: tracing while you draw, analysing when a lesion or activation layer is selected. Off: the toolbar is as it has always been.">
            <Switch checked={taskToolbar} onCheckedChange={setTaskToolbar} label="Task toolbar" testId="pref-task-toolbar" />
          </Row>
          <Row title="Movable panels"
            hint="A small grip on a panel lets you drag it: drop it on a highlighted edge of the viewer to dock it there, or anywhere else to float it; double-click the grip to float it or put it back. Saved for each preset.">
            <Switch checked={movable} onCheckedChange={setMovable} label="Movable panels" testId="pref-movable-panels" />
          </Row>
          {movable && (
            <>
              <Row title="Layer settings can move">
                <Switch checked={movableInspector} onCheckedChange={setMovableInspector} label="Layer settings can move" testId="pref-movable-inspector" />
              </Row>
              <Row title="Toolbar can move">
                <Switch checked={movableToolbar} onCheckedChange={setMovableToolbar} label="Toolbar can move" testId="pref-movable-toolbar" />
              </Row>
              <Row title="Readout can move">
                <Switch checked={movableReadout} onCheckedChange={setMovableReadout} label="Readout can move" testId="pref-movable-readout" />
              </Row>
              <Row title="Sidebar sections can move" hint="Drag a section by the grip on its row: drop it in the sidebar to reorder, or over the viewer to float it.">
                <Switch checked={movableSections} onCheckedChange={setMovableSections} label="Sidebar sections can move" testId="pref-movable-sections" />
              </Row>
              <Row title="Put everything back" hint="Docks every panel and every floating section where it started, for the preset in use. A section's order is kept (see Sections and their order).">
                <button type="button" className="btn-mini" data-testid="pref-panels-reset"
                  onClick={() => setLayouts(layoutReducer(layouts, { type: "reset", preset: presetKey }))}>Reset</button>
              </Row>
            </>
          )}
        </Group>
        <Group title="Sections and their order">
          <div className="pb-1 pt-2 text-[12.5px] leading-snug text-muted-foreground">
            Drag a section by its handle to move it, or focus the handle and press Alt+Up or Alt+Down. The rail follows the same order.
          </div>
          <SectionOrderList />
        </Group>
      </>
    ),
    notifications: (
      <Group>
        <Row title="Tell me when a long job ends"
          hint="A system notification when network mapping, tract dissection or a report finishes while MRLatte isn't the window in front. It names the job, never the scan.">
          <Switch checked={notify} onCheckedChange={setNotify} label="Tell me when a long job ends" testId="pref-job-notifications" />
        </Row>
      </Group>
    ),
    performance: (
      <Group>
        <Row title="Performance mode" hint="One switch for a slower computer or a long session on battery.">
          <button type="button" className="icon-btn h-7 w-7" onClick={() => setPerfInfo((v) => !v)} aria-expanded={perfInfo}
            aria-label="What Performance mode changes" title="What Performance mode changes" data-testid="pref-performance-info">
            <Info size={15} />
          </button>
          <Switch checked={performance} onCheckedChange={setPerformance} label="Performance mode" testId="pref-performance-mode" />
        </Row>
        {perfInfo && (
          <div className="my-1 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground" data-testid="pref-performance-details">
            <div className="font-medium text-foreground">Performance mode, while on:</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Transparency off: the window is opaque, menus are not frosted.</li>
              <li>Visual effects off: scans, layers and checks appear at once, nothing glows.</li>
              <li>The first-run screen is not blurred.</li>
              <li>Faster 3D while moving: on (the setting below).</li>
            </ul>
            <div className="mt-1">Your own choices below are kept and come back when it's off.</div>
          </div>
        )}
        <Row title="Visual effects"
          hint="A scan develops as it loads, a new layer blooms in, a passed check rings the lesion, and sections and layers glow once. Off: everything appears at once. Reduce Motion in your system settings also turns them off.">
          <Switch checked={effects && !performance} onCheckedChange={setEffects} disabled={performance}
            label="Visual effects" testId="pref-visual-effects" />
        </Row>
        <Row title="Faster 3D while moving"
          hint={`While you turn or zoom the 3D view, MRLatte draws it more coarsely only if frames run slow, then sharp again when you stop, as Blender does. Slices, measurements, screenshots and reports are always full quality.${performance ? " On while Performance mode is on." : ""}`}>
          <Switch checked={lowRes || performance} onCheckedChange={setLowRes} disabled={performance}
            label="Faster 3D while moving" testId="pref-lowres-rotate" />
        </Row>
      </Group>
    ),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(620px,85vh)] max-w-2xl w-[94vw] gap-0 overflow-hidden bg-panel border border-edge p-0 text-foreground" data-testid="preferences-dialog">
        <div className="flex h-full min-h-0 min-w-0">
          <nav aria-label="Preferences" className="flex w-44 flex-shrink-0 flex-col gap-0.5 border-r border-border p-2.5">
            <DialogHeader className="px-2 pb-2.5 pt-1 text-left">
              <DialogTitle className="text-[15px]">Preferences</DialogTitle>
              <DialogDescription className="sr-only">Kept on this computer. Changes apply at once.</DialogDescription>
            </DialogHeader>
            {PAGES.map(({ id, title, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}
                className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
                  page === id ? "bg-panel-active text-foreground" : "text-muted-foreground hover:bg-panel-hover hover:text-foreground"
                }`}
                data-testid={`pref-page-${id}`}>
                <Icon size={14} className="flex-shrink-0" />{title}
              </button>
            ))}
            <div className="mt-auto px-2 text-[11.5px] leading-snug text-subtle">Kept on this computer. Changes apply at once.</div>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 thin-scroll" data-testid={`pref-body-${page}`}>
            <h2 className="mb-1 text-[15px] font-semibold text-foreground">{PAGES.find((p) => p.id === page).title}</h2>
            {body[page]}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PreferencesDialog;
