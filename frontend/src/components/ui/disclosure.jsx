import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

// A row that folds a group of controls away (sidebar declutter, approved
// 28 Oct): a title, an optional status on the right of it, and an optional
// action beside the row that works without opening it (Position's Reset).
// Folded content stays mounted, only hidden, so what it holds (an overlap
// table, a half-typed coordinate) survives folding. `open` / `onOpenChange`
// make it controlled, for a button elsewhere that opens it.
export function Disclosure({ title, status, action, defaultOpen = false, open: openProp, onOpenChange, testId, className, bodyClassName = "space-y-2", children }) {
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen)
  const open = openProp ?? ownOpen
  const setOpen = (fn) => {
    const next = typeof fn === "function" ? fn(open) : fn
    if (onOpenChange) onOpenChange(next)
    else setOwnOpen(next)
  }
  const bodyId = React.useId()
  return (
    <div className={className} data-testid={testId} data-open={open}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <ChevronRight size={14} className={cn("flex-shrink-0 transition-transform", open && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate" title={typeof title === "string" ? title : undefined}>{title}</span>
          {status}
        </button>
        {action}
      </div>
      <div id={bodyId} hidden={!open} className={cn("pb-2.5 pt-0.5", bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
