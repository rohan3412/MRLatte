import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"
import { snapValue } from "@/lib/sliderMath"

// Radix puts role="slider" on the Thumb, not the Root, so the accessible name
// has to land on the Thumb: `aria-label` is taken off the Root and given to it.
//
// `snaps`: values the slider catches when dragged near them (lib/sliderMath),
// each marked on the track; the knob pulses once when it lands on one. Hold
// Alt to slide past them. The readout beside a slider (EditableNumber) can
// always be typed into or stepped, for a value just next to a snap point.
const Slider = React.forwardRef(({ className, "aria-label": ariaLabel, snaps, onValueChange, min = 0, max = 100, ...props }, ref) => {
  const alt = React.useRef(false)
  const [pulse, setPulse] = React.useState(0)
  const last = React.useRef(null)
  const handle = snaps?.length
    ? (vals) => {
        const r = snapValue(vals[0], snaps, min, max, { bypass: alt.current })
        if (r.snapped && last.current !== r.value) setPulse((n) => n + 1)
        last.current = r.snapped ? r.value : null
        onValueChange?.([r.value, ...vals.slice(1)])
      }
    : onValueChange
  return (
    <SliderPrimitive.Root
      ref={ref}
      min={min}
      max={max}
      onValueChange={handle}
      onPointerDownCapture={(e) => { alt.current = e.altKey }}
      onPointerMoveCapture={(e) => { alt.current = e.altKey }}
      className={cn("relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-40", className)}
      {...props}>
      <SliderPrimitive.Track
        className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-edge">
        <SliderPrimitive.Range className="absolute h-full bg-muted-foreground" />
      </SliderPrimitive.Track>
      {snaps?.map((s) => (
        <span key={s} className="slider-snap" style={{ left: `${((s - min) / (max - min)) * 100}%` }} aria-hidden="true" />
      ))}
      {/* Alternating names restart the pulse without remounting the knob mid-drag. */}
      <SliderPrimitive.Thumb className="slider-knob" data-pulse={pulse ? (pulse % 2 ? "a" : "b") : undefined} aria-label={ariaLabel} />
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
