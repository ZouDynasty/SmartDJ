import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ListMusic, Pause, Play, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildSetPoints, formatDuration } from '@/lib/setMath'
import type { SetPoint } from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

interface SetCardProps {
  point: SetPoint
  isHighlighted: boolean
  isPlaying: boolean
  onRemove: (instanceId: string) => void
  onHover: (instanceId: string | null) => void
  onPlay: (instanceId: string) => void
}

/** Minor (A) keys read cool, major (B) keys read warm — quick harmonic scan. */
function keyBadgeClass(keyLabel: string): string {
  if (keyLabel.endsWith('A')) {
    return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
  }
  if (keyLabel.endsWith('B')) {
    return 'border-amber-400/40 bg-amber-400/10 text-amber-300'
  }
  return 'border-slate-700 bg-slate-800 text-slate-400'
}

function SetCard({
  point,
  isHighlighted,
  isPlaying,
  onRemove,
  onHover,
  onPlay,
}: SetCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.instanceId })

  return (
    <li
      ref={setNodeRef}
      data-instance-id={point.instanceId}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHover(point.instanceId)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'group relative flex w-full cursor-grab flex-col gap-2 rounded-lg border p-3',
        'bg-slate-900 transition-colors select-none',
        isHighlighted
          ? 'border-cyan-400 bg-slate-800 shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_0_24px_-6px_rgba(34,211,238,0.6)]'
          : 'border-slate-800 hover:border-slate-700',
        isDragging && 'z-10 cursor-grabbing opacity-80 shadow-2xl shadow-black/60',
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-2">
        <span className="font-mono text-xs font-semibold text-slate-500">
          {String(point.index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {point.title}
          </p>
          <p className="truncate text-xs text-slate-400">{point.artist}</p>
        </div>
        <button
          type="button"
          aria-label={`Remove ${point.title} from set`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(point.instanceId)
          }}
          className={cn(
            'rounded p-1 text-slate-500 transition-colors',
            'hover:bg-rose-500/15 hover:text-rose-400',
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-xs text-cyan-300">
          {point.bpm === null ? '—' : point.bpm.toFixed(1)}
        </span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-xs',
            keyBadgeClass(point.keyLabel),
          )}
        >
          {point.keyLabel}
        </span>
        <span className="ml-auto font-mono text-xs text-slate-400">
          {formatDuration(point.durationSec)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-fuchsia-400"
            style={{ width: `${(point.energy ?? 0) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs text-fuchsia-300">
          {point.energy === null ? '—' : point.energy.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-t border-slate-800 pt-2 text-xs text-slate-500">
        <button
          type="button"
          aria-label={isPlaying ? `Pause ${point.title}` : `Play ${point.title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onPlay(point.instanceId)
          }}
          className={cn(
            'flex size-5 items-center justify-center rounded-full transition-colors',
            isPlaying
              ? 'bg-cyan-400 text-slate-950'
              : 'text-slate-500 hover:bg-slate-700 hover:text-cyan-300',
          )}
        >
          {isPlaying ? (
            <Pause className="size-2.5 fill-current" />
          ) : (
            <Play className="size-2.5 fill-current" />
          )}
        </button>
        <span className="font-mono">
          {formatDuration(point.startSec)} →{' '}
          {formatDuration(point.startSec + point.durationSec)}
        </span>
        <GripVertical className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </li>
  )
}

export function SetBuilder() {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const moveSetItem = useSetStore((state) => state.moveSetItem)
  const removeSetItem = useSetStore((state) => state.removeSetItem)
  const clearSet = useSetStore((state) => state.clearSet)
  const highlightedInstanceId = useSetStore(
    (state) => state.highlightedInstanceId,
  )
  const highlightSource = useSetStore((state) => state.highlightSource)
  const setHighlight = useSetStore((state) => state.setHighlight)
  const playTrack = useSetStore((state) => state.playTrack)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)

  const listRef = useRef<HTMLOListElement>(null)
  const points = useMemo(() => buildSetPoints(activeQueue), [activeQueue])
  const ids = useMemo(() => points.map((point) => point.instanceId), [points])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  /** Graph hovers scroll the matching card into view; queue hovers must not. */
  useEffect(() => {
    if (highlightSource !== 'graph' || highlightedInstanceId === null) return
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-instance-id="${highlightedInstanceId}"]`,
    )
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightSource, highlightedInstanceId])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from === -1 || to === -1) return
      moveSetItem(from, to)
    },
    [ids, moveSetItem],
  )

  const handleHover = useCallback(
    (instanceId: string | null) => {
      setHighlight(instanceId, 'queue')
    },
    [setHighlight],
  )

  const handlePlay = useCallback(
    (instanceId: string) => {
      const item = activeQueue.find((entry) => entry.instance_id === instanceId)
      if (item) playTrack(item.track)
    },
    [activeQueue, playTrack],
  )

  return (
    <section className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-950">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ListMusic className="size-4 shrink-0 text-fuchsia-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Active Set Queue
          </h2>
          <span className="ml-auto font-mono text-xs text-slate-500">
            {activeQueue.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-600">
            drag to reorder
          </span>
          {activeQueue.length > 0 && (
            <button
              type="button"
              onClick={clearSet}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md border border-slate-800 px-2 py-0.5',
                'text-xs text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400',
              )}
            >
              <Trash2 className="size-3" />
              Clear
            </button>
          )}
        </div>
      </header>

      {points.length === 0 ? (
        <div className="m-3 rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
          <p className="text-sm text-slate-500">
            Queue is empty — add tracks from the catalog.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol
              ref={listRef}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
            >
              {points.map((point) => (
                <SetCard
                  key={point.instanceId}
                  point={point}
                  isHighlighted={point.instanceId === highlightedInstanceId}
                  isPlaying={
                    isPlaying && playingTrack?.track_id === point.trackId
                  }
                  onRemove={removeSetItem}
                  onHover={handleHover}
                  onPlay={handlePlay}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
