// What the DICOM import's progress bar shows (inbox 4 Nov: "better loading
// bar for loading series"). An import goes through four steps:
//   upload   — the files go to the analysis engine (real bytes and %);
//   convert  — dcm2niix turns them into NIfTI series (no % exists: elapsed time);
//   download — the chosen series comes back (real bytes and %, when the size is known);
//   open     — the viewer reads it (elapsed time).
// `p` is { stage, loaded?, total?, files?, since? } as useBaseVolume sets it;
// `now` is Date.now(). Picking another series from the list starts at
// "download", with the first two steps already done.
export const DICOM_STEPS = [
  { key: "upload", label: "Upload" },
  { key: "convert", label: "Convert" },
  { key: "download", label: "Download" },
  { key: "open", label: "Open" },
];

export function formatMB(bytes) {
  if (!Number.isFinite(bytes)) return "–";
  const mb = bytes / 1e6;
  return mb >= 100 ? `${Math.round(mb)} MB` : mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

export function dicomProgressView(p, now = Date.now()) {
  if (!p) return null;
  const at = Math.max(0, DICOM_STEPS.findIndex((s) => s.key === p.stage));
  const known = Number.isFinite(p.total) && p.total > 0 && Number.isFinite(p.loaded);
  const fraction = known ? Math.min(1, Math.max(0, p.loaded / p.total)) : null;
  const elapsed = Number.isFinite(p.since) ? `${Math.max(0, Math.floor((now - p.since) / 1000))} s` : null;
  const files = formatCount(p.files);

  const steps = DICOM_STEPS.map((s, i) => ({
    ...s,
    state: i < at ? "done" : i === at ? "active" : "todo",
    // Only the steps with real byte counts fill; the others show activity.
    fraction: i === at && (s.key === "upload" || s.key === "download") ? fraction : null,
  }));

  let title, detail, right;
  switch (p.stage) {
    case "upload":
      title = "Uploading";
      detail = known ? `${formatMB(p.loaded)} of ${formatMB(p.total)}${files ? ` · ${files} files` : ""}` : files ? `${files} files` : "";
      right = fraction != null ? `${Math.round(fraction * 100)}%` : null;
      break;
    case "convert":
      title = "Converting";
      detail = `dcm2niix is converting ${files ? `${files} files` : "the files"}`;
      right = elapsed;
      break;
    case "download":
      title = "Downloading the series";
      detail = known ? `${formatMB(p.loaded)} of ${formatMB(p.total)}` : Number.isFinite(p.loaded) ? formatMB(p.loaded) : "";
      right = fraction != null ? `${Math.round(fraction * 100)}%` : null;
      break;
    default:
      title = "Opening the series";
      detail = "Reading it into the viewer";
      right = elapsed;
  }
  return { steps, title, detail, right, step: at + 1, of: DICOM_STEPS.length };
}
