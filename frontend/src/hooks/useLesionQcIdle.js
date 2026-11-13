import { useEffect, useRef, useState } from "react";
import { runLesionQc, runLiveQc } from "@/lib/lesionQc";
import { getCapabilities, hasFeature, closeLiveQc } from "@/lib/lesionMetrics";
import { getPref } from "@/lib/preferences";

// Live mode (lqtpy 0.8.0+, `qc.session`): instead of waiting for a pause, the
// drawing is checked shortly after every stroke, in memory on the backend
// (about 35 ms there), and the result is always on show as a small badge,
// clean or not (`live`). The pause-and-warn behaviour below stays for an
// older lqtpy. Both follow the same Preferences switch.
const LIVE_DEBOUNCE_MS = 500;

/**
 * Idle-drawing quality check (owner's idea-inbox request: "give a warning
 * during drawing after a certain time limit of no drawing"). While paint
 * mode is on and the drawing has content, run lqtpy QC in the background
 * after a pause in drawing (Preferences: on/off and how long, 30 s by default),
 * and return any flags as
 * `idleWarning` — never a modal (a modal popping up mid-stroke would be
 * infuriating). Dashboard shows it as a persistent orange warning on the
 * viewer (not a toast, which vanished after a few seconds — owner's
 * follow-up request): it stays until the drawing changes again or paint
 * mode turns off, both of which clear it here.
 *
 * Draw-change signal: NiivueViewer exposes a SINGLE-SLOT draw-change
 * callback (`setDrawChangeCallback`, drawingApi.js), and Dashboard.jsx
 * already occupies that slot for retinotopy's `drawingHasContent`.
 * Registering a second callback here would silently replace Dashboard's and
 * break retinotopy — so this hook does NOT touch the viewer's callback slot
 * at all. Instead it returns `notifyDrawChange`, a STABLE function (never
 * changes identity across renders — safe to capture once in Dashboard's
 * existing, empty-deps draw-change effect without going stale, per the
 * "Stale closures" invariant in CLAUDE.md §6) that Dashboard calls from
 * INSIDE its existing handler, alongside what it already does.
 *
 * Don't-nag: runs at most once per distinct drawing state, keyed on the
 * upload's content hash (`lesionId`, sha256 of the drawing's NIfTI bytes —
 * see lib/lesionMetrics.js's uploadLesion). An unchanged drawing hashes to
 * the same id and is never re-surfaced; only a NEW draw-change resets the
 * idle timer that leads to a NEW check.
 *
 * @param {{viewerRef: object, active: boolean, mni: boolean}} args
 * @returns {{notifyDrawChange: () => void, idleWarning: {flags: object[], provenance: object, lesionId: string}|null,
 *   live: {flags: object[], verdict: string|null, needsAttention: boolean, provenance: object}|null}}
 *   `live`: the latest live check (live mode only, see LIVE_DEBOUNCE_MS), clean ones too.
 */
export function useLesionQcIdle({ viewerRef, active, mni }) {
  // Live mirrors for the stable notifyDrawChange closure below — read
  // fresh every call instead of capturing a stale render's props.
  const activeRef = useRef(active);
  activeRef.current = active;
  const mniRef = useRef(mni);
  mniRef.current = mni;

  // The flagged QC result currently on show, or null. setIdleWarning is
  // stable, so the stable closures below can call it safely.
  const [idleWarning, setIdleWarning] = useState(null);
  const [live, setLive] = useState(null);
  // Whether this lqtpy can check live (asked when paint mode turns on), and the
  // id of this drawing's session on the backend. A check that comes back after
  // a newer one was asked for is dropped (`liveSeqRef`).
  const liveOkRef = useRef(false);
  const sessionRef = useRef(null);
  const liveSeqRef = useRef(0);

  const timerRef = useRef(null);
  // lesionId of the drawing state already surfaced (warning shown) or found
  // clean — never re-checked again until the content actually changes.
  const lastCheckedIdRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const runIdleCheck = async () => {
    if (!activeRef.current) return; // paint mode already off — don't bother
    const result = await runLesionQc({
      viewerRef, mni: mniRef.current, fileName: "qc_idle_drawing.nii.gz",
      // The background check only has to notice trouble, so it runs lqtpy
      // 0.6.0's quicker tier (it skips the slow plausibility checks). Save and
      // Download still run the full one. Older lqtpy ignores this.
      tier: "fast",
    });
    if (!result) return; // fail-open path (see lib/lesionQc.js) — nothing to show
    if (!activeRef.current) return; // turned off while the request was in flight
    if (lastCheckedIdRef.current === result.lesionId) return; // already surfaced this exact drawing
    lastCheckedIdRef.current = result.lesionId;
    if (!result.needsAttention) return; // clean, or Notes only — nothing to warn about
    setIdleWarning(result);
  };

  // In a ref: it reads only refs and a state setter, so one copy serves every
  // render (the stable draw-change closure below and the effect use it).
  const runLiveRef = useRef(async () => {
    if (!activeRef.current) return;
    const seq = ++liveSeqRef.current;
    if (!sessionRef.current) sessionRef.current = `drawing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await runLiveQc({ viewerRef, session: sessionRef.current, mni: mniRef.current });
    if (seq !== liveSeqRef.current || !activeRef.current) return; // a newer stroke, or paint mode off
    setLive(result);   // null: an empty drawing, or nothing to say right now
  });

  // Stable across renders (initialised once) — see the function doc above
  // for why this must never be recreated. Any drawing change retires the
  // warning on show: it described a drawing that no longer exists.
  const notifyDrawChangeRef = useRef(() => {
    clearTimer();
    setIdleWarning(null);
    if (!activeRef.current) return;
    // Preferences can switch it off or change the pause; read at each draw
    // change, so a change there applies to the next pause.
    if (!getPref("idleQc")) { setLive(null); return; }
    if (liveOkRef.current) {
      timerRef.current = setTimeout(runLiveRef.current, LIVE_DEBOUNCE_MS);
      return;
    }
    timerRef.current = setTimeout(runIdleCheck, getPref("idleQcSeconds") * 1000);
  });

  // Paint mode on: ask once whether this lqtpy checks live (the LQTpy module
  // may have been installed or updated since). Off: stop the pending check,
  // drop what is on show and forget the backend session.
  useEffect(() => {
    if (active) {
      let gone = false;
      getCapabilities().then((caps) => {
        if (gone) return;
        liveOkRef.current = hasFeature(caps, "qc.session");
        // A drawing that is already there gets its badge at once.
        if (liveOkRef.current && getPref("idleQc")) runLiveRef.current();
      }).catch(() => { liveOkRef.current = false; });
      return () => { gone = true; };
    }
    clearTimer();
    setIdleWarning(null);
    setLive(null);
    liveSeqRef.current += 1;
    if (sessionRef.current) { closeLiveQc(sessionRef.current); sessionRef.current = null; }
    return undefined;
  }, [active]);

  useEffect(() => () => {
    clearTimer();
    if (sessionRef.current) closeLiveQc(sessionRef.current);
  }, []);

  return { notifyDrawChange: notifyDrawChangeRef.current, idleWarning, live };
}
