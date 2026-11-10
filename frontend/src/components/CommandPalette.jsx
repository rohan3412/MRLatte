import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

/** Commands matching `query`: every word must start a word of the title or
 *  group (so "ax" finds "Axial", "save work" finds "Save workspace…"). */
export function matchCommands(commands, query) {
  // Split like the titles are, so punctuation typed from a title ("preset:") still matches.
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const hay = `${c.title} ${c.group}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => hay.some((h) => h.startsWith(w)));
  });
}

/**
 * Command palette (Ctrl+K / Cmd+K; owner, 5 Nov): type to reach any action,
 * sidebar section or preset, so a hidden or reordered section is never hard
 * to get to. `commands`: [{ id, title, group, keys?, run }], built by
 * Dashboard from the same handlers the menus and shortcuts use.
 */
export function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useMemo(() => matchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
  }, [open]);
  useEffect(() => { setAt(0); }, [query]);

  if (!open) return null;
  // After the palette has closed, so a command that opens a dialog or moves
  // focus is not fighting the palette for it.
  const run = (c) => { onClose(); setTimeout(() => c.run(), 0); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && list[at]) { e.preventDefault(); run(list[at]); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose}
      data-testid="command-palette">
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="popover w-[560px] max-w-[92vw] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search size={15} className="text-subtle" />
          {/* autoFocus: focused as it mounts, so keys typed right after
              Ctrl+K land here, never on the viewer's one-letter shortcuts. */}
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Type a command, a section or a preset" aria-label="Search commands"
            aria-activedescendant={list[at] ? `cmd-${list[at].id}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle"
            data-testid="command-palette-input" />
        </div>
        <ul role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto p-1.5 thin-scroll">
          {list.length === 0 && <li className="px-3 py-3 text-[13px] text-muted-foreground">Nothing matches “{query}”.</li>}
          {list.map((c, i) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === at}
              onMouseEnter={() => setAt(i)} onClick={() => run(c)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px] ${i === at ? "bg-panel-active text-foreground" : "text-muted-foreground"}`}
              data-testid={`command-${c.id}`}>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="cap text-subtle">{c.group}</span>
              {c.keys && <kbd className="rounded border border-border px-1.5 font-mono text-[11px] text-subtle">{c.keys}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
