// The task toolbar (Preferences > Panels > Task toolbar, off by default): which
// set the bar shows. Pure so the rules are testable; Dashboard supplies the facts.

export const TOOL_MODES = ["viewing", "tracing", "analysing"];

/** The task a state calls for, or null when there is none:
 *  tracing while draw mode is on; analysing while a lesion or activation layer
 *  is selected in the inspector. Tracing wins (you are mid-stroke). */
export function suggestedTask({ drawingActive, inspectedKind }) {
  if (drawingActive) return "tracing";
  if (inspectedKind === "lesion" || inspectedKind === "activation") return "analysing";
  return null;
}

/** The set to show. `chosen` is what the mode button last picked ("viewing" or
 *  the task set); `auto` is the task a canvas interaction brought up, which
 *  holds only while it is still the suggested one. A task set that no longer
 *  applies falls back to Viewing. */
export function resolveToolMode({ enabled, chosen, auto, suggested }) {
  if (!enabled) return "viewing";
  if (auto && auto === suggested) return auto;
  if (chosen === "viewing") return "viewing";
  return suggested || "viewing";
}

/** What the mode button does next: from Viewing to the task set that applies
 *  (null = nothing applies, so the button has no task to go to), from a task
 *  back to Viewing. */
export function nextChoice(current, suggested) {
  if (current !== "viewing") return { chosen: "viewing", auto: null };
  return suggested ? { chosen: suggested, auto: null } : null;
}
