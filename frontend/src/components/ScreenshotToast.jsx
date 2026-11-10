import React from "react";
import { toast } from "sonner";
import { ExternalLink, FolderOpen } from "lucide-react";

// Camera-style screenshot (owner, 5 Nov): after the viewer's flash, a
// thumbnail settles in the corner for a few seconds. In the desktop app the
// PNG is already saved in Pictures\MRLatte, so it can be opened or shown in
// its folder; the browser build downloads it as before and shows the picture.
export function showScreenshotToast({ thumb, filePath, savedAs }) {
  const reveal = (open) => window.mrlatte?.revealScreenshot?.(filePath, open);
  toast.custom((id) => (
    <div className="popover flex w-[300px] items-center gap-3 p-2.5" data-testid="screenshot-toast">
      <button type="button" onClick={() => { if (filePath) reveal(true); toast.dismiss(id); }}
        className="keep-colours flex-shrink-0 overflow-hidden rounded-md border border-border"
        title={filePath ? "Open the screenshot" : "Screenshot"}>
        <img src={thumb} alt="Screenshot" className="block h-[60px] w-[90px] object-cover" />
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-[13px] font-medium text-foreground">Screenshot saved</div>
        {filePath ? (
          <div className="flex gap-1.5">
            <button type="button" className="btn-mini" onClick={() => { reveal(true); toast.dismiss(id); }}>
              <ExternalLink size={11} /> Open
            </button>
            <button type="button" className="btn-mini" onClick={() => { reveal(false); toast.dismiss(id); }}>
              <FolderOpen size={11} /> Show in folder
            </button>
          </div>
        ) : (
          <div className="truncate text-[12px] text-muted-foreground" title={savedAs || undefined}>
            {savedAs ? savedAs.split(/[\\/]/).pop() : "In your downloads."}
          </div>
        )}
      </div>
    </div>
  ), { duration: 5000 });
}
