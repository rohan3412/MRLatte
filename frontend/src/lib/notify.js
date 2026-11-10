import { getPref } from "@/lib/preferences";

// A system notification when a long job ends while MRLatte isn't the window in
// front (owner, 5 Nov; optional: Preferences ▸ Notify when a long job ends).
// Names the job only, never a file or patient: notifications can show on a
// lock screen. Nothing happens while MRLatte has focus, where the panel's own
// toast already says it.
export function notifyIfAway(title, body) {
  try {
    if (!getPref("jobNotifications") || document.hasFocus()) return;
    if (typeof Notification === "undefined") return;
    const show = () => { try { new Notification(title, { body }); } catch (_e) { /* not allowed here */ } };
    if (Notification.permission === "granted") show();
    else if (Notification.permission !== "denied") Notification.requestPermission().then((p) => { if (p === "granted") show(); });
  } catch (_e) {
    // never let a notification break a job's own finish
  }
}
