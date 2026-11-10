import React from "react";
import { MapPin, Activity } from "lucide-react";

/**
 * CrosshairInfo — current crosshair location, voxel values, and atlas labels.
 * The readout (owner, 6 Nov): a frosted chip in the viewer's corner, or a tag
 * beside the crosshair (Preferences ▸ Viewer ▸ Readout); the same content.
 *
 * Props:
 *   mm     : [x, y, z] in MNI mm
 *   vox    : [i, j, k] voxel indices in base volume
 *   values : Array<{ name: string, value: number }> — per loaded volume
 *   labels : { [layerName]: string } — categorical atlas hits
 *   bare   : no frame of its own (a Movable or the tag supplies it)
 *   stacked: one item per line (docked beside the viewer, a narrow column)
 */
export const CrosshairInfo = ({ mm, vox, values = [], labels = {}, bare = false, stacked = false }) => {
  const labelEntries = Object.entries(labels).filter(([, v]) => v);
  const visibleValues = (values || []).filter((v) => typeof v.value === "number");

  const fmt = (n) => {
    if (!Number.isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a === 0) return "0";
    if (a < 0.01 || a >= 10000) return n.toExponential(2);
    return Number(n).toFixed(a < 1 ? 3 : 2);
  };

  // Every number sits in a fixed-width mono column (tabular figures, the
  // padding kept by whitespace-pre), so nothing to its right slides sideways as
  // digits change; the names are in their own fixed-width key column and
  // crossfade on change. The rows keep their height as labels come and go.
  return (
    <div
      role="status"
      aria-label="Crosshair"
      className={`flex w-max max-w-full flex-col gap-1 px-3 py-2 text-[11.5px] ${bare ? "" : "frosted rounded-[10px]"}`}
      data-testid="crosshair-info"
    >
      <div className={stacked ? "flex flex-col items-start gap-y-1" : "flex flex-nowrap items-center gap-x-4"}>
        <div className="flex flex-shrink-0 items-center gap-[7px] whitespace-nowrap">
          <MapPin size={12} className="text-subtle" />
          <span className="cap text-subtle">MNI</span>
          <span className="ro-num text-[12px] text-foreground" data-testid="crosshair-mm">
            {mm
              ? `${mm[0].toFixed(1).padStart(6)} ${mm[1].toFixed(1).padStart(6)} ${mm[2].toFixed(1).padStart(6)}`
              : "—".padStart(20)}
          </span>
        </div>
        {vox && (
          <div className="flex flex-shrink-0 items-center gap-[7px] whitespace-nowrap">
            <span className="cap text-subtle">Vox</span>
            <span className="ro-num text-[12px] text-muted-foreground">
              {vox.map((v) => String(Math.round(v)).padStart(3)).join(" ")}
            </span>
          </div>
        )}
      </div>
      {visibleValues.length > 0 && (
        <div className={stacked ? "flex flex-col items-start gap-y-0.5 whitespace-nowrap" : "flex flex-nowrap items-center gap-x-3 whitespace-nowrap"} data-testid="crosshair-values">
          {!stacked && <Activity size={12} className="flex-shrink-0 text-subtle" />}
          {visibleValues.map((v, i) => (
            <div key={`${v.name}-${i}`} className="flex flex-shrink-0 items-center gap-1.5">
              <span className="cap max-w-[9ch] truncate text-subtle" title={v.name}>{v.name}</span>
              <span
                className="ro-num inline-block min-w-[8ch] text-right text-[12px] text-foreground"
                data-testid={`crosshair-val-${v.name}`}
              >
                {fmt(v.value)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-0.5" data-testid="crosshair-labels">
        {labelEntries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 whitespace-nowrap">
            <span className="cap w-[7.5rem] flex-shrink-0 truncate text-subtle" title={k}>{k}</span>
            <span key={v} className="fade-swap max-w-[260px] truncate text-foreground" title={v}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CrosshairInfo;
