import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { FolderOpen, ListMusic, Pause, Play, Save, Trash2, X } from 'lucide-react'
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

/** Minor (A) keys read blue, major (B) keys read grey — quick harmonic scan. */
function keyBadgeClass(keyLabel: string): string {
  if (keyLabel.endsWith('A')) {
    return 'bg-blue-100 text-blue-800'
  }
  if (keyLabel.endsWith('B')) {
    return 'bg-slate-200 text-slate-800'
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
          ? 'border-accent bg-theme-raised shadow-[0_0_0_1px_rgba(29,78,216,0.35)]'
          : 'border-theme-line hover:border-accent',
        isDragging &&
          'z-10 cursor-grabbing opacity-90 shadow-lg shadow-slate-900/20',
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
          <span className="text-blue-700">
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
          <span className="text-ink">
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
          'group-hover:opacity-100 hover:bg-slate-200 hover:text-ink',
        )}
      >
        <X className="size-3" />
      </button>
    </li>
  )
}

export function SetBuilder({ width }: { width: number }) {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const savedSets = useSetStore((state) => state.savedSets)
  const loadedSetId = useSetStore((state) => state.loadedSetId)
  const moveSetItem = useSetStore((state) => state.moveSetItem)
  const removeSetItem = useSetStore((state) => state.removeSetItem)
  const clearSet = useSetStore((state) => state.clearSet)
  const saveSet = useSetStore((state) => state.saveSet)
  const loadSavedSet = useSetStore((state) => state.loadSavedSet)
  const deleteSavedSet = useSetStore((state) => state.deleteSavedSet)
  const highlightedInstanceId = useSetStore(
    (state) => state.highlightedInstanceId,
  )
  const highlightSource = useSetStore((state) => state.highlightSource)
  const setHighlight = useSetStore((state) => state.setHighlight)
  const playTrack = useSetStore((state) => state.playTrack)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)

  const [setName, setSetName] = useState('')
  const [showSaved, setShowSaved] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const loadedSet = savedSets.find((entry) => entry.id === loadedSetId) ?? null

  useEffect(() => {
    if (loadedSet) setSetName(loadedSet.name)
  }, [loadedSet])
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

  const handleSave = useCallback(() => {
    saveSet(setName)
  }, [saveSet, setName])

  const canSave = activeQueue.length > 0 && setName.trim().length > 0

  return (
    <section
      className="flex min-w-0 shrink-0 flex-col bg-theme"
      style={{ width }}
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-theme-line bg-theme-raised px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ListMusic className="size-4 shrink-0 text-accent" />
          <h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-ink">
            {loadedSet?.name ?? 'Active Set Queue'}
          </h2>
          <span className="ml-auto font-mono text-xs text-ink-muted">
            {activeQueue.length}
          </span>
        </div>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) handleSave()
          }}
        >
          <input
            type="text"
            value={setName}
            onChange={(event) => setSetName(event.target.value)}
            placeholder="Name this set…"
            className={cn(
              'min-w-0 flex-1 rounded-md border border-theme-line bg-theme px-2 py-1',
              'text-xs text-ink placeholder:text-ink-faint',
              'outline-none focus:border-accent',
            )}
          />
          <button
            type="submit"
            disabled={!canSave}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold',
              canSave
                ? 'border-accent bg-accent text-white hover:bg-accent-hover'
                : 'cursor-not-allowed border-theme-line text-ink-faint',
            )}
          >
            <Save className="size-3" />
            Save
          </button>
        </form>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowSaved((open) => !open)
              setPendingDeleteId(null)
            }}
            className={cn(
              'flex items-center gap-1 rounded-md border border-theme-line px-2 py-0.5',
              'text-xs text-ink-muted transition-colors hover:text-ink',
              showSaved && 'border-accent text-ink',
            )}
          >
            <FolderOpen className="size-3" />
            Saved
            {savedSets.length > 0 && (
              <span className="font-mono text-ink-faint">{savedSets.length}</span>
            )}
          </button>
          <span className="font-mono text-xs text-ink-muted">
            drag to reorder
          </span>
          {activeQueue.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearSet()
                setSetName('')
              }}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md border border-theme-line px-2 py-0.5',
                'text-xs text-ink-muted transition-colors hover:border-ink hover:text-ink',
              )}
            >
              <Trash2 className="size-3" />
              Clear
            </button>
          )}
        </div>
        {showSaved && (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-theme-line bg-theme">
            {savedSets.length === 0 ? (
              <li className="px-2 py-2 text-xs text-ink-muted">
                No saved sets yet.
              </li>
            ) : (
              savedSets.map((entry) => {
                const isLoaded = entry.id === loadedSetId
                const confirming = pendingDeleteId === entry.id
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      'border-b border-theme-line/60 last:border-b-0',
                      isLoaded && !confirming && 'bg-theme-raised',
                      confirming && 'bg-rose-50',
                    )}
                  >
                    {confirming ? (
                      <div className="flex flex-col gap-1.5 px-2 py-1.5">
                        <p className="text-xs font-medium text-ink">
                          Delete {entry.name}?
                        </p>
                        <p className="text-[10px] text-ink-muted">
                          Are you sure? This cannot be undone.
                        </p>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="rounded-md border border-theme-line px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteSavedSet(entry.id)
                              setPendingDeleteId(null)
                            }}
                            className="rounded-md border border-rose-400 bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-600"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            loadSavedSet(entry.id)
                            setSetName(entry.name)
                            setShowSaved(false)
                            setPendingDeleteId(null)
                          }}
                          className="min-w-0 flex-1 px-2 py-1.5 text-left"
                        >
                          <p className="truncate text-xs font-medium text-ink">
                            {entry.name}
                          </p>
                          <p className="font-mono text-[10px] text-ink-faint">
                            {entry.track_ids.length} tracks
                          </p>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${entry.name}`}
                          onClick={() => setPendingDeleteId(entry.id)}
                          className="mr-1 rounded p-1 text-ink-faint hover:bg-slate-200 hover:text-ink"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        )}
      </header>

      {points.length === 0 ? (
        <div className="m-3 rounded-lg border border-dashed border-theme-line bg-theme-raised px-4 py-8 text-center">
          <p className="text-sm text-ink-muted">
            Queue is empty — drop tracks on Now and Next, then find the shortest
            mixing path between them.
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
