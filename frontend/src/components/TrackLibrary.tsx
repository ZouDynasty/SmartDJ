import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronUp,
  Disc3,
  Link2,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  X,
} from 'lucide-react'
import { endTrackDrag, setTrackDragData } from '@/lib/dragTrack'
import { cn } from '@/lib/utils'
import {
  camelotIndex,
  camelotRelation,
  formatDuration,
  isMixCompatible,
  normalizedEnergy,
  trackArtist,
  trackBpm,
  trackDuration,
  trackGenre,
  trackKey,
  trackRating,
  trackTitle,
} from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'
import type { SortDirection, SortField, Track } from '@/types'

const ROW_HEIGHT = 44
const MAX_GENRE_TAGS = 16

/** Shared grid template keeps the sticky header aligned with virtual rows. */
const GRID_TEMPLATE =
  'grid-cols-[32px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,1.4fr)_68px_60px_104px_92px_84px]'

/** Nulls always sink to the bottom regardless of sort direction. */
function compareNumeric(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function compareText(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function compareTracks(a: Track, b: Track, field: SortField): number {
  switch (field) {
    case 'title':
      return compareText(trackTitle(a), trackTitle(b))
    case 'artist':
      return compareText(trackArtist(a), trackArtist(b))
    case 'genre':
      return compareText(trackGenre(a), trackGenre(b))
    case 'bpm':
      return compareNumeric(trackBpm(a), trackBpm(b))
    case 'key':
      return compareNumeric(
        camelotIndex(trackKey(a)),
        camelotIndex(trackKey(b)),
      )
    case 'energy':
      return compareNumeric(normalizedEnergy(a), normalizedEnergy(b))
    case 'rating':
      return compareNumeric(trackRating(a), trackRating(b))
  }
}

function SortHeading({
  field,
  label,
  active,
  direction,
  align = 'left',
  onSort,
}: {
  field: SortField
  label: string
  active: boolean
  direction: SortDirection
  align?: 'left' | 'right'
  onSort: (field: SortField) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      title={
        active
          ? `Sorted ${direction === 'asc' ? 'ascending' : 'descending'} — click to reverse`
          : `Sort by ${label}`
      }
      className={cn(
        'flex items-center gap-0.5 uppercase tracking-wider transition-colors',
        align === 'right' && 'w-full justify-end',
        active ? 'text-ink' : 'hover:text-ink',
      )}
    >
      {label}
      {active &&
        (direction === 'asc' ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        ))}
    </button>
  )
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'size-3',
            star <= rating
              ? 'fill-accent text-accent'
              : 'text-ink-faint',
          )}
        />
      ))}
    </span>
  )
}

export function TrackLibrary() {
  const catalog = useSetStore((state) => state.catalog)
  const catalogStatus = useSetStore((state) => state.catalogStatus)
  const catalogError = useSetStore((state) => state.catalogError)
  const searchQuery = useSetStore((state) => state.searchQuery)
  const setSearchQuery = useSetStore((state) => state.setSearchQuery)
  const sortField = useSetStore((state) => state.sortField)
  const setSortField = useSetStore((state) => state.setSortField)
  const sortDirection = useSetStore((state) => state.sortDirection)
  const toggleSortDirection = useSetStore((state) => state.toggleSortDirection)
  const genreFilters = useSetStore((state) => state.genreFilters)
  const toggleGenreFilter = useSetStore((state) => state.toggleGenreFilter)
  const clearGenreFilters = useSetStore((state) => state.clearGenreFilters)
  const addTrackToSet = useSetStore((state) => state.addTrackToSet)
  const selectedTrack = useSetStore((state) => state.selectedTrack)
  const setSelectedTrack = useSetStore((state) => state.setSelectedTrack)
  const playTrack = useSetStore((state) => state.playTrack)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const activeQueue = useSetStore((state) => state.activeQueue)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [draggingTrackId, setDraggingTrackId] = useState<number | null>(null)
  const [showCompatible, setShowCompatible] = useState(false)

  const compatibleSeed = useMemo(() => {
    const candidates = [
      playingTrack,
      selectedTrack,
      activeQueue.at(-1)?.track ?? null,
    ]
    return (
      candidates.find((track) => {
        if (!track || trackBpm(track) === null) return false
        const relation = camelotRelation(trackKey(track), trackKey(track))
        return relation !== null
      }) ?? null
    )
  }, [activeQueue, playingTrack, selectedTrack])

  /** Most common genres first so the tag row stays useful on big libraries. */
  const genreOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const track of catalog) {
      const genre = trackGenre(track)
      if (!genre) continue
      counts.set(genre, (counts.get(genre) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_GENRE_TAGS)
  }, [catalog])

  const visibleTracks = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    const genres = new Set(genreFilters)
    const filtered = catalog.filter((track) => {
      if (genres.size > 0) {
        const genre = trackGenre(track)
        if (!genre || !genres.has(genre)) return false
      }
      if (showCompatible && compatibleSeed) {
        if (track.track_id === compatibleSeed.track_id) return false
        if (!isMixCompatible(compatibleSeed, track)) return false
      }
      if (needle.length === 0) return true
      return (
        trackTitle(track).toLowerCase().includes(needle) ||
        trackArtist(track).toLowerCase().includes(needle)
      )
    })
    const factor = sortDirection === 'asc' ? 1 : -1
    return filtered.sort((a, b) => factor * compareTracks(a, b, sortField))
  }, [
    catalog,
    compatibleSeed,
    genreFilters,
    searchQuery,
    showCompatible,
    sortDirection,
    sortField,
  ])

  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) toggleSortDirection()
      else setSortField(field)
    },
    [setSortField, sortField, toggleSortDirection],
  )

  const handleAdd = useCallback(
    (track: Track) => {
      addTrackToSet(track)
    },
    [addTrackToSet],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-canvas">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2 text-ink">
          <Disc3 className="size-4 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            DJ Catalog
          </h2>
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-muted">
          {visibleTracks.length} / {catalog.length}
        </span>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search title or artist…"
            className={cn(
              'w-full rounded-md border border-line bg-raised py-1.5 pl-8 pr-3',
              'text-xs text-ink placeholder:text-ink-faint',
              'outline-none focus:border-accent',
            )}
          />
        </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {genreOptions.map(([genre, count]) => {
              const isActive = genreFilters.includes(genre)
              return (
                <button
                  key={genre}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleGenreFilter(genre)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    isActive
                      ? 'border-theme-line bg-theme text-ink'
                      : 'border-line bg-raised text-ink-muted hover:text-ink',
                  )}
                >
                  {genre}
                  <span
                    className={cn(
                      'ml-1.5 font-mono tabular-nums',
                      isActive ? 'text-ink-muted' : 'text-ink-faint',
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
            {genreFilters.length > 0 && (
              <button
                type="button"
                onClick={clearGenreFilters}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
              >
                <X className="size-3" />
                Clear
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <button
              type="button"
              disabled={!compatibleSeed}
              title={
                compatibleSeed
                  ? `Show tracks that mix with ${trackTitle(compatibleSeed)} — same or adjacent Camelot, BPM within 10%`
                  : 'Select or play a track with BPM and key first'
              }
              onClick={() => setShowCompatible((current) => !current)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-semibold tracking-tight transition-colors',
                showCompatible && compatibleSeed
                  ? 'border-accent bg-accent text-white shadow-sm shadow-accent/30'
                  : 'border-accent bg-theme-raised text-accent hover:bg-theme',
                !compatibleSeed &&
                  'cursor-not-allowed border-line bg-raised text-ink-faint hover:bg-raised',
              )}
            >
              <Link2 className="size-4" />
              {showCompatible ? 'Showing compatible' : 'Show compatible'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div
          className={cn(
            'grid shrink-0 items-center gap-2 border-b border-line bg-raised px-3 py-2',
            'text-xs font-medium uppercase tracking-wider text-ink-muted',
            GRID_TEMPLATE,
          )}
        >
          <span />
          <SortHeading
            field="title"
            label="Title"
            active={sortField === 'title'}
            direction={sortDirection}
            onSort={handleSort}
          />
          <SortHeading
            field="artist"
            label="Artist"
            active={sortField === 'artist'}
            direction={sortDirection}
            onSort={handleSort}
          />
          <SortHeading
            field="genre"
            label="Genre"
            active={sortField === 'genre'}
            direction={sortDirection}
            onSort={handleSort}
          />
          <SortHeading
            field="bpm"
            label="BPM"
            active={sortField === 'bpm'}
            direction={sortDirection}
            align="right"
            onSort={handleSort}
          />
          <SortHeading
            field="key"
            label="Key"
            active={sortField === 'key'}
            direction={sortDirection}
            align="right"
            onSort={handleSort}
          />
          <SortHeading
            field="energy"
            label="Energy"
            active={sortField === 'energy'}
            direction={sortDirection}
            align="right"
            onSort={handleSort}
          />
          <SortHeading
            field="rating"
            label="Rating"
            active={sortField === 'rating'}
            direction={sortDirection}
            onSort={handleSort}
          />
          <span className="text-right">Add</span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {catalogStatus === 'loading' && (
            <p className="px-3 py-6 text-sm text-ink-muted">Loading catalog…</p>
          )}
          {catalogStatus === 'error' && (
            <p className="px-3 py-6 text-sm text-rose-500">
              {catalogError ?? 'Failed to load the catalog.'}
            </p>
          )}
          {catalogStatus === 'ready' && visibleTracks.length === 0 && (
            <p className="px-3 py-6 text-sm text-ink-muted">
              No tracks match the current filters.
            </p>
          )}

          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const track = visibleTracks[virtualRow.index]
              const energy = normalizedEnergy(track)
              const bpm = trackBpm(track)
              const isSelected = selectedTrack?.id === track.id
              const isPlayingRow =
                isPlaying && playingTrack?.track_id === track.track_id
              return (
                <div
                  key={`${track.id}-${track.track_id}`}
                  draggable
                  onDragStart={(event) => {
                    setTrackDragData(event.dataTransfer, track)
                    setSelectedTrack(track)
                    setDraggingTrackId(track.track_id)
                  }}
                  onDragEnd={() => {
                    setDraggingTrackId(null)
                    endTrackDrag()
                  }}
                  onClick={() => setSelectedTrack(track)}
                  onDoubleClick={() => handleAdd(track)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    'grid cursor-grab items-center gap-2 border-b border-line/50 px-3 active:cursor-grabbing',
                    GRID_TEMPLATE,
                    draggingTrackId === track.track_id
                      ? 'border border-dashed border-accent bg-transparent opacity-40'
                      : isSelected
                        ? 'bg-theme'
                        : 'odd:bg-raised/70 hover:bg-raised',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Play ${trackTitle(track)}`}
                    draggable={false}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      playTrack(track)
                    }}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full transition-colors',
                      isPlayingRow
                        ? 'bg-accent text-white'
                        : 'text-ink-muted hover:bg-theme hover:text-accent',
                    )}
                  >
                    {isPlayingRow ? (
                      <Pause className="size-3 fill-current" />
                    ) : (
                      <Play className="size-3 fill-current" />
                    )}
                  </button>
                  <span className="truncate text-sm text-ink">
                    {trackTitle(track)}
                    <span className="ml-2 font-mono text-xs text-ink-faint">
                      {formatDuration(trackDuration(track))}
                    </span>
                  </span>
                  <span className="truncate text-sm text-ink-muted">
                    {trackArtist(track)}
                  </span>
                  <span className="truncate text-xs text-ink-faint">
                    {trackGenre(track) ?? '—'}
                  </span>
                  <span className="text-right font-mono text-xs text-blue-700">
                    {bpm === null ? '—' : bpm.toFixed(1)}
                  </span>
                  <span className="text-right font-mono text-xs text-slate-600">
                    {trackKey(track) ?? '—'}
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="h-1 w-10 overflow-hidden rounded-full bg-canvas">
                      <span
                        className="block h-full rounded-full bg-ink"
                        style={{ width: `${(energy ?? 0) * 100}%` }}
                      />
                    </span>
                    <span className="font-mono text-xs text-ink">
                      {energy === null ? '—' : energy.toFixed(2)}
                    </span>
                  </span>
                  <RatingStars rating={trackRating(track)} />
                  <span className="flex justify-end">
                    <button
                      type="button"
                      aria-label={`Add ${trackTitle(track)} to set`}
                      draggable={false}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleAdd(track)
                      }}
                      className={cn(
                        'flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-1',
                        'text-xs font-medium text-ink-muted transition-colors',
                        'hover:border-accent hover:bg-theme hover:text-ink',
                      )}
                    >
                      <Plus className="size-3" />
                      Set
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
