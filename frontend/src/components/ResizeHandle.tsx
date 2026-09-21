import { useRef } from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  /** `x` splits left/right (col-resize). `y` splits top/bottom (row-resize). */
  axis: 'x' | 'y'
  /** Flip the delta so dragging toward the panel grows it. */
  invert?: boolean
  label: string
  onDrag: (deltaFromStart: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function ResizeHandle({
  axis,
  invert = false,
  label,
  onDrag,
  onDragStart,
  onDragEnd,
}: ResizeHandleProps) {
  const startRef = useRef(0)
  const draggingRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  const cursor = axis === 'x' ? 'col-resize' : 'row-resize'

  const endDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    cleanupRef.current?.()
    cleanupRef.current = null
    document.body.classList.remove('is-panel-resizing')
    document.body.style.removeProperty('cursor')
    onDragEnd?.()
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        draggingRef.current = true
        startRef.current = axis === 'x' ? event.clientX : event.clientY
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic or already-released pointers can reject capture.
        }
        document.body.classList.add('is-panel-resizing')
        document.body.style.cursor = cursor
        onDragStart?.()

        const onMove = (moveEvent: PointerEvent) => {
          if (!draggingRef.current) return
          const pos = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
          const delta = pos - startRef.current
          onDrag(invert ? -delta : delta)
        }
        const onUp = () => endDrag()
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        cleanupRef.current = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }}
      className={cn(
        'group relative z-20 shrink-0 touch-none select-none border-0 p-0',
        'bg-seam hover:bg-accent active:bg-accent',
        axis === 'x' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
    >
      <span
        className={cn(
          'absolute',
          axis === 'x'
            ? 'inset-y-0 -left-1 w-2.5 cursor-col-resize'
            : 'inset-x-0 -top-1 h-2.5 cursor-row-resize',
        )}
      />
    </button>
  )
}
