import React, { useEffect, useRef, useState } from "react";
import { Brain, Clock, FolderOpen, X } from "lucide-react";

// When MRLatte opens without a file (owner, 5 Nov): recent scans with a small
// picture each, a way to open a file, and the MNI152 template as the quiet
// default. Opening a NIfTI from Explorer still goes straight to the scan; this
// is the contrast for a plain start. Desktop app only: main keeps the list
// (electron.js "Recent scans") and grants read access to its own entries only.
// Thumbnails stay on this computer; Clear recent removes them with the list.
const when = (t) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// `onOpenRecent(file, path)`: a recent entry is always a base scan, opened
// with its path so it keeps its place (and gets a fresh picture) in the list.
export function HomeScreen({ onOpenFiles, onOpenRecent, onDismiss }) {
  const [recent, setRecent] = useState(null);
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let live = true;
    window.mrlatte?.getRecent?.().then((r) => { if (live) setRecent(r || []); }).catch(() => setRecent([]));
    const onKey = (e) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => { live = false; window.removeEventListener("keydown", onKey); };
  }, [onDismiss]);

  const openRecent = async (r) => {
    setBusy(r.path);
    try {
      const ok = await window.mrlatte.openRecent(r.path);
      const res = ok?.ok ? await window.mrlatte.readOpenFile(r.path) : null;
      if (!res?.ok) { setRecent((list) => list.map((x) => (x.path === r.path ? { ...x, missing: true } : x))); return; }
      await onOpenRecent(new File([res.bytes], res.name || r.name), r.path);
      onDismiss();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="home-screen absolute inset-0 z-30 flex items-center justify-center p-6" data-testid="home-screen">
      <div className="popover relative w-full max-w-2xl p-6">
        <button type="button" onClick={onDismiss} className="icon-btn absolute right-2.5 top-2.5 h-7 w-7"
          aria-label="Close and show the template" title="Close (Esc)"><X size={15} /></button>
        <h2 className="text-[20px] font-semibold text-foreground">Open a scan</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Drop a NIfTI file anywhere on the window, open one, or pick a recent scan.</p>

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} data-testid="home-open-file">
            <FolderOpen size={13} /> Open a file…
          </button>
          <button type="button" className="btn" onClick={onDismiss} data-testid="home-template">
            <Brain size={13} /> Continue with the MNI152 template
          </button>
          <input ref={fileRef} type="file" accept=".nii,.nii.gz,.mif,.mif.gz" multiple className="hidden"
            onChange={async (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) { await onOpenFiles(files); onDismiss(); } }} />
        </div>

        {recent?.length > 0 && (
          <>
            <div className="mt-6 flex items-center gap-2">
              <Clock size={12} className="text-subtle" />
              <span className="cap flex-1 text-subtle">Recent</span>
              <button type="button" className="btn-mini" onClick={async () => { await window.mrlatte.clearRecent(); setRecent([]); }}
                data-testid="home-clear-recent">Clear recent</button>
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="home-recent">
              {recent.map((r) => (
                <li key={r.path}>
                  <button type="button" disabled={r.missing || !!busy} onClick={() => openRecent(r)}
                    className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-edge disabled:opacity-50"
                    title={r.missing ? `${r.path} (not found)` : r.path}>
                    <div className="keep-colours grid h-24 w-full place-items-center bg-black">
                      {r.thumb ? <img src={r.thumb} alt="" className="h-full w-full object-cover" /> : <Brain size={22} className="text-subtle" />}
                    </div>
                    <div className="min-w-0 px-2 py-1.5">
                      <div className="truncate text-[12.5px] font-medium text-foreground">{busy === r.path ? "Opening…" : r.name}</div>
                      <div className="truncate text-[11.5px] text-subtle">{r.missing ? "Not found" : when(r.openedAt)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default HomeScreen;
