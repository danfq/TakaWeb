import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.9
const RESIZE_STEP = 32

/**
 * keep a width within the sheet's limits
 *
 * @param width requested width in px
 *
 * @returns {number} clamped width
 */
const clampWidth = (width: number): number =>
  Math.round(
    Math.min(Math.max(width, MIN_WIDTH), window.innerWidth * MAX_WIDTH_RATIO)
  )

/**
 * a side sheet width the user can drag, remembered per sheet
 *
 * @param storageKey local storage key
 * @param defaultWidth starting width in px
 *
 * @returns width and a setter that also stores it
 */
function useSheetWidth(storageKey: string | undefined, defaultWidth: number) {
  const [width, setWidth] = React.useState(defaultWidth)

  React.useEffect(() => {
    if (!storageKey) return

    const stored = Number(localStorage.getItem(storageKey))
    if (stored) setWidth(clampWidth(stored))
  }, [storageKey])

  const store = React.useCallback(
    (next: number) => {
      if (!storageKey) return

      try {
        localStorage.setItem(storageKey, String(next))
      } catch {}
    },
    [storageKey]
  )

  return { width, setWidth, store }
}

/**
 * drag handle on a side sheet's inner edge, also works with arrow keys
 */
function SheetResizeHandle({
  side,
  width,
  defaultWidth,
  onResize,
  onCommit,
}: {
  side: "left" | "right"
  width: number
  defaultWidth: number
  onResize: (width: number) => void
  onCommit: (width: number) => void
}) {
  const [dragging, setDragging] = React.useState(false)
  const latest = React.useRef(width)
  latest.current = width

  /**
   * width for a pointer position
   *
   * @param clientX pointer x
   *
   * @returns {number} width
   */
  const fromPointer = (clientX: number) =>
    clampWidth(side === "right" ? window.innerWidth - clientX : clientX)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={0}
      data-side={side}
      data-dragging={dragging || undefined}
      className="group/resize absolute inset-y-0 z-10 w-3 cursor-col-resize touch-none outline-none select-none max-sm:hidden data-[side=left]:-right-1.5 data-[side=right]:-left-1.5"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (dragging) onResize(fromPointer(event.clientX))
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
        onCommit(latest.current)
      }}
      onDoubleClick={() => {
        onResize(defaultWidth)
        onCommit(defaultWidth)
      }}
      onKeyDown={(event) => {
        const grow = side === "right" ? "ArrowLeft" : "ArrowRight"
        const shrink = side === "right" ? "ArrowRight" : "ArrowLeft"
        if (event.key !== grow && event.key !== shrink) return

        event.preventDefault()
        const next = clampWidth(
          width + (event.key === grow ? RESIZE_STEP : -RESIZE_STEP)
        )
        onResize(next)
        onCommit(next)
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover/resize:bg-ring group-data-dragging/resize:bg-ring" />
    </div>
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  resizable = false,
  storageKey,
  defaultWidth = 448,
  style,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  // drag the inner edge to resize, side sheets only
  resizable?: boolean
  // remembers the width across visits
  storageKey?: string
  defaultWidth?: number
}) {
  const { width, setWidth, store } = useSheetWidth(storageKey, defaultWidth)
  const canResize = resizable && (side === "left" || side === "right")

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        style={
          canResize
            ? { width: `min(${width}px, 100vw)`, maxWidth: "none", ...style }
            : style
        }
        className={cn(
          "fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground shadow-xl transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-secondary"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
        {/* last in tab order, so opening by keyboard lands on the content */}
        {canResize && (
          <SheetResizeHandle
            side={side as "left" | "right"}
            width={width}
            defaultWidth={defaultWidth}
            onResize={setWidth}
            onCommit={store}
          />
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
