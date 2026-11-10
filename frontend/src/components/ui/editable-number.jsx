import * as React from "react"

import { ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { niceStep } from "@/lib/sliderMath"

// A slider's value readout that can be typed into: double-click it, type, then
// Enter (or click away) applies and Esc cancels. The typed number is clamped to
// the slider's [min, max], and rounded when the slider only takes whole
// numbers. `value` and `onCommit` use the slider's own scale (opacity 0–100,
// not 0–1), so a caller passes exactly what its slider's onValueChange does.
// `children` is the usual readout, shown unchanged while not editing.
// Hovering it shows tiny up/down steppers: one `step` a click (a sensible
// fraction of the range by default, lib/sliderMath), ten with Shift.
const EditableNumber = ({ value, min, max, integer = false, step, onCommit, label, className, children, ...props }) => {
  const [draft, setDraft] = React.useState(null)
  // Enter / Esc finish the edit themselves, and the blur that follows (or a
  // click away) must not apply it a second time.
  const editing = React.useRef(false)

  const start = () => {
    editing.current = true
    setDraft(String(Number(Number(value).toFixed(integer ? 0 : 4))))
  }
  const finish = (apply) => {
    if (!editing.current) return
    editing.current = false
    const v = parseFloat(String(draft).replace(",", "."))
    setDraft(null)
    if (!apply || !Number.isFinite(v)) return
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(v) : v))
    if (clamped !== value) onCommit(clamped)
  }

  const by = step ?? niceStep(min, max, integer)
  const decimals = (String(by).split(".")[1] || "").length
  const bump = (e, dir) => {
    e.preventDefault()
    e.stopPropagation()
    const next = Number((Number(value) + dir * by * (e.shiftKey ? 10 : 1)).toFixed(decimals))
    const clamped = Math.min(max, Math.max(min, next))
    if (clamped !== value) onCommit(clamped)
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true)
          else if (e.key === "Escape") { e.stopPropagation(); finish(false) }
        }}
        className={cn(className, "field h-6 min-h-0 min-w-[3.25rem] px-1 text-right font-mono text-[11.5px]")}
        {...props}
      />
    )
  }
  return (
    <span
      onDoubleClick={start}
      title={`${label}: double-click to type a value`}
      className={cn("num-edit cursor-text", className)}
      {...props}
    >
      {children}
      <span className="num-steps">
        <button type="button" tabIndex={-1} aria-label={`${label}: up`} onClick={(e) => bump(e, 1)}
          onDoubleClick={(e) => e.stopPropagation()}><ChevronUp size={9} strokeWidth={2.5} /></button>
        <button type="button" tabIndex={-1} aria-label={`${label}: down`} onClick={(e) => bump(e, -1)}
          onDoubleClick={(e) => e.stopPropagation()}><ChevronDown size={9} strokeWidth={2.5} /></button>
      </span>
    </span>
  )
}

export { EditableNumber }
