import React from "react";
import { ChevronDown, Search } from "lucide-react";
import coMark from "@/assets/cophe-mark-96.jpg";

// MRLatte's own title bar in the desktop app (owner, 6 Nov): one 40px row in
// place of the system title bar and the menu row. Left to right: the COPHE
// mark, the "MRLatte" menu button (Windows and Linux; macOS keeps its menu at
// the top of the screen), the base file's name (the preset chip went, owner
// 10 Nov; the logo's tooltip gives the version), and the centred search button that opens the command palette.
// The bar is a drag region; every control opts out of it (index.css). The
// native window buttons (Windows, Linux) are drawn by Electron over its right
// end: titleBarOverlay in electron.js. Not rendered in a browser.
export const AppTitleBar = ({ baseName, onSearch }) => {
  const mac = window.mrlatte?.platform === "darwin";
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.mrlatte?.popupAppMenu?.(r.left, r.bottom);
  };
  return (
    <header
      className="app-titlebar flex h-10 flex-shrink-0 select-none items-center gap-2 border-b border-border bg-panel text-[12.5px]"
      // Left: room for the macOS traffic lights. Right: the window buttons.
      style={{
        paddingLeft: mac ? 78 : 10,
        paddingRight: mac ? 10 : "calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%) + 10px)",
      }}
      data-testid="app-titlebar"
    >
      <img src={coMark} alt="COPHE" title={process.env.REACT_APP_VERSION ? `MRLatte ${process.env.REACT_APP_VERSION}` : "MRLatte"} width={22} height={22} className="h-[22px] w-[22px] flex-shrink-0 rounded-[5px]" draggable={false} />
      {!mac && (
        <button type="button" onClick={openMenu} className="tb-b flex-shrink-0 font-medium" aria-haspopup="menu"
          title="Menu" data-testid="titlebar-menu">
          MRLatte<ChevronDown size={12} />
        </button>
      )}
      <div className="flex min-w-0 flex-shrink items-center gap-2" data-testid="titlebar-file">
        {mac && <span className="flex-shrink-0 font-medium text-foreground">MRLatte</span>}
        <span className="min-w-0 truncate text-muted-foreground" title={baseName}>{baseName}</span>
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <button type="button" onClick={onSearch}
          className="flex h-7 w-full max-w-[420px] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
          title={`Search commands, sections and presets (${mac ? "⌘K" : "Ctrl+K"})`} data-testid="titlebar-search">
          <Search size={13} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search commands, sections and presets</span>
          <kbd className="flex-shrink-0 rounded border border-border px-1.5 font-mono text-[11px] text-subtle">
            {mac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </div>
    </header>
  );
};

export default AppTitleBar;
