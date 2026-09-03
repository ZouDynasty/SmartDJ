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
import { ListMusic, Pause, Play, Trash2, X } from 'lucide-react'
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
    return 'bg-sky-100 text-sky-700'
  }
  if (keyLabel.endsWith('B')) {
    return 'bg-amber-100 text-amber-700'
  }
  return 'bg-raised text-ink-muted'
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
        'group relative flex w-full cursor-grab items-center gap-2 rounded-md border px-2 py-1.5',
        'bg-theme-raised transition-colors select-none',
        isHighlighted
          ? 'border-accent bg-theme-raised shadow-[0_0_0_1px_rgba(212,92,92,0.35)]'
          : 'border-theme-line hover:border-accent',
        isDragging &&
          'z-10 cursor-grabbing opacity-90 shadow-lg shadow-zinc-500/30',
      )}
      {...attributes}
      {...listeners}
    >
      {/* Index doubles as the play control on hover, saving a column. */}
      <button
        type="button"
        aria-label={isPlaying ? `Pause ${point.title}` : `Play ${point.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onPlay(point.instanceId)
        }}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded font-mono text-xs transition-colors',
          isPlaying
            ? 'bg-accent text-white'
            : 'text-ink-muted hover:bg-theme hover:text-accent',
        )}
      >
        {isPlaying ? (
          <Pause className="size-2.5 fill-current" />
        ) : (
          <>
            <span className="group-hover:hidden">
              {String(point.index + 1).padStart(2, '0')}
            </span>
            <Play className="hidden size-2.5 fill-current group-hover:block" />
          </>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight text-ink">
          {point.title}
        </p>
        <p className="flex items-center gap-1 truncate text-[11px] leading-tight text-ink-muted">
          <span className="truncate">{point.artist}</span>
          <span className="ml-auto shrink-0 font-mono text-ink-faint">
            {formatDuration(point.startSec)}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] leading-tight">
        <span className="flex items-center gap-1">
          <span className="text-sky-600">
            {point.bpm === null ? '—' : point.bpm.toFixed(0)}
          </span>
          <span
            className={cn(
              'rounded px-1 text-[10px]',
              keyBadgeClass(point.keyLabel),
            )}
          >
            {point.keyLabel}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-violet-600">
            {point.energyRaw === null ? '—' : point.energyRaw.toFixed(1)}
          </span>
          <span className="text-ink-faint">
            {formatDuration(point.durationSec)}
          </span>
        </span>
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
          'shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-all',
          'group-hover:opacity-100 hover:bg-rose-100 hover:text-rose-500',
        )}
      >
        <X className="size-3" />
      </button>
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
    <section className="flex w-80 shrink-0 flex-col bg-theme">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-theme-line bg-theme-raised px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ListMusic className="size-4 shrink-0 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
            Active Set Queue
          </h2>
          <span className="ml-auto font-mono text-xs text-ink-muted">
            {activeQueue.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">
            drag to reorder
          </span>
          {activeQueue.length > 0 && (
            <button
              type="button"
              onClick={clearSet}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md border border-theme-line px-2 py-0.5',
                'text-xs text-ink-muted transition-colors hover:border-rose-400 hover:text-rose-600',
              )}
            >
              <Trash2 className="size-3" />
              Clear
            </button>
          )}
        </div>
      </header>

      {points.length === 0 ? (
        <div className="m-3 rounded-lg border border-dashed border-theme-line bg-theme-raised px-4 py-8 text-center">
          <p className="text-sm text-ink-muted">
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
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
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
