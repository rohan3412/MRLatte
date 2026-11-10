import React, { useState } from "react";
import { Check, RotateCcw, Save, Trash2 } from "lucide-react";
import { usePreference } from "@/lib/preferences";
import { SECTIONS } from "@/lib/sections";
import { allPresets, applyPreset, deleteCustom, resetEdit, saveAsNew, saveEdit } from "@/lib/presets";

const TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));

/**
 * The presets as cards: what each is for, how it differs from the others, and
 * the sections it shows. Used in Preferences ▸ Presets (with Update, Reset,
 * Delete and Save as) and in the first-run questionnaire (`compact`: pick only).
 */
export function PresetCards({ compact = false, onPicked }) {
  const [active] = usePreference("activePreset");
  // Re-read on any preset change (edits, saves, deletes).
  usePreference("presetEdits");
  usePreference("customPresets");
  const [name, setName] = useState("");
  const presets = allPresets();

  const use = (p) => { applyPreset(p); onPicked?.(p); };

  return (
    <div className="space-y-2" data-testid="preset-cards">
      {presets.map((p) => {
        const on = active === p.id;
        return (
          <div key={p.id}
            className={`rounded-lg border p-3 transition-colors ${on ? "border-edge bg-panel-active" : "border-border bg-card"}`}
            data-testid={`preset-${p.id}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground">{p.name}</span>
                  {on && <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"><Check size={11} /> In use</span>}
                  {p.edited && <span className="cap text-subtle">edited</span>}
                  {p.custom && <span className="cap text-subtle">yours</span>}
                </div>
                {p.summary && <div className="mt-0.5 text-[13px] text-foreground">{p.summary}</div>}
                {p.detail && <div className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{p.detail}</div>}
                <div className="mt-1.5 text-[12px] leading-snug text-subtle">
                  Shows: {p.sections.map((id) => TITLE[id]).join(" · ")}
                </div>
              </div>
              {/* One highlighted button per screen (design rule): only Everything's,
                  the recommended start, and only while it isn't in use. */}
              <button type="button" className={!on && p.id === "everything" ? "btn-primary" : "btn"} onClick={() => use(p)}
                data-testid={`preset-use-${p.id}`}>{on ? "Apply again" : "Use"}</button>
            </div>
            {!compact && (p.custom || on || p.edited) && (
              <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                {!p.custom && on && (
                  <button type="button" className="btn-mini" onClick={() => saveEdit(p.id)}
                    title="Make this preset what the sidebar and viewer are set to now">
                    <Save size={11} /> Update to my current setup
                  </button>
                )}
                {p.edited && (
                  <button type="button" className="btn-mini" onClick={() => resetEdit(p.id)}>
                    <RotateCcw size={11} /> Reset to default
                  </button>
                )}
                {p.custom && (
                  <button type="button" className="btn-mini !text-destructive" onClick={() => deleteCustom(p.id)}>
                    <Trash2 size={11} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!compact && (
        <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { saveAsNew(name); setName(""); } }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name for the current setup"
            className="field min-w-0 flex-1" aria-label="Name for a new preset" maxLength={40} data-testid="preset-new-name" />
          <button type="submit" className="btn" disabled={!name.trim()} data-testid="preset-save-new">
            <Save size={12} /> Save as a preset
          </button>
        </form>
      )}
    </div>
  );
}

export default PresetCards;
