import { useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Disc3,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  camelotIndex,
  formatDuration,
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
import type { SortField, Track } from '@/types'

const ROW_HEIGHT = 44
const MAX_GENRE_TAGS = 16

/** Shared grid template keeps the sticky header aligned with virtual rows. */
const GRID_TEMPLATE =
  'grid-cols-[32px_minmax(0,3fr)_minmax(0,2fr)_minmax(0,1.4fr)_68px_60px_104px_92px_84px]'

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'genre', label: 'Genre' },
  { value: 'bpm', label: 'BPM' },
  { value: 'key', label: 'Key' },
  { value: 'energy', label: 'Energy' },
  { value: 'rating', label: 'Rating' },
]

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

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'size-3',
            star <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'text-slate-700',
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

  const scrollRef = useRef<HTMLDivElement>(null)

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
      .map(([genre]) => genre)
  }, [catalog])

  const visibleTracks = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    const genres = new Set(genreFilters)
    const filtered = catalog.filter((track) => {
      if (genres.size > 0) {
        const genre = trackGenre(track)
        if (!genre || !genres.has(genre)) return false
      }
      if (needle.length === 0) return true
      return (
        trackTitle(track).toLowerCase().includes(needle) ||
        trackArtist(track).toLowerCase().includes(needle)
      )
    })
    const factor = sortDirection === 'asc' ? 1 : -1
    return filtered.sort((a, b) => factor * compareTracks(a, b, sortField))
  }, [catalog, genreFilters, searchQuery, sortDirection, sortField])

  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const handleAdd = useCallback(
    (track: Track) => {
      addTrackToSet(track)
    },
    [addTrackToSet],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-slate-950">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2 text-slate-300">
          <Disc3 className="size-4 text-amber-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            DJ Catalog
          </h2>
        </div>
        <span className="font-mono text-xs text-slate-500">
          {visibleTracks.length} / {catalog.length}
        </span>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search title or artist…"
            className={cn(
              'w-56 rounded-md border border-slate-800 bg-slate-900 py-1.5 pl-8 pr-3',
              'text-xs text-slate-100 placeholder:text-slate-500',
              'outline-none focus:border-cyan-500/60',
            )}
          />
        </div>

        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Select by
          <select
            value={sortField}
            onChange={(event) =>
              setSortField(event.target.value as SortField)
            }
            className={cn(
              'rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5',
              'text-xs text-slate-100 outline-none focus:border-cyan-500/60',
            )}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={toggleSortDirection}
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5',
            'text-xs text-slate-300 transition-colors hover:border-slate-600',
          )}
        >
          {sortDirection === 'asc' ? (
            <ArrowUpAZ className="size-3.5" />
          ) : (
            <ArrowDownAZ className="size-3.5" />
          )}
          {sortDirection === 'asc' ? 'Asc' : 'Desc'}
        </button>
      </header>

      {genreOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
          {genreOptions.map((genre) => {
            const isActive = genreFilters.includes(genre)
            return (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenreFilter(genre)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  isActive
                    ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200',
                )}
              >
                {genre}
              </button>
            )
          })}
          {genreFilters.length > 0 && (
            <button
              type="button"
              onClick={clearGenreFilters}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-slate-500 hover:text-rose-400"
            >
              <X className="size-3" />
              Clear
            </button>
          )}
        </div>
      )}

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800">
        <div
          className={cn(
            'grid shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2',
            'text-xs font-medium uppercase tracking-wider text-slate-500',
            GRID_TEMPLATE,
          )}
        >
          <span />
          <span>Title</span>
          <span>Artist</span>
          <span>Genre</span>
          <span className="text-right">BPM</span>
          <span className="text-right">Key</span>
          <span className="text-right">Energy</span>
          <span>Rating</span>
          <span className="text-right">Add</span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {catalogStatus === 'loading' && (
            <p className="px-3 py-6 text-sm text-slate-500">Loading catalog…</p>
          )}
          {catalogStatus === 'error' && (
            <p className="px-3 py-6 text-sm text-rose-400">
              {catalogError ?? 'Failed to load the catalog.'}
            </p>
          )}
          {catalogStatus === 'ready' && visibleTracks.length === 0 && (
            <p className="px-3 py-6 text-sm text-slate-500">
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
                    'grid cursor-default items-center gap-2 border-b border-slate-800/60 px-3',
                    GRID_TEMPLATE,
                    isSelected
                      ? 'bg-cyan-400/10'
                      : 'odd:bg-slate-900/30 hover:bg-slate-800/60',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Play ${trackTitle(track)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      playTrack(track)
                    }}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full transition-colors',
                      isPlayingRow
                        ? 'bg-cyan-400 text-slate-950'
                        : 'text-slate-500 hover:bg-slate-700 hover:text-cyan-300',
                    )}
                  >
                    {isPlayingRow ? (
                      <Pause className="size-3 fill-current" />
                    ) : (
                      <Play className="size-3 fill-current" />
                    )}
                  </button>
                  <span className="truncate text-sm text-slate-100">
                    {trackTitle(track)}
                    <span className="ml-2 font-mono text-xs text-slate-600">
                      {formatDuration(trackDuration(track))}
                    </span>
                  </span>
                  <span className="truncate text-sm text-slate-400">
                    {trackArtist(track)}
                  </span>
                  <span className="truncate text-xs text-slate-500">
                    {trackGenre(track) ?? '—'}
                  </span>
                  <span className="text-right font-mono text-xs text-cyan-300">
                    {bpm === null ? '—' : bpm.toFixed(1)}
                  </span>
                  <span className="text-right font-mono text-xs text-amber-300">
                    {trackKey(track) ?? '—'}
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="h-1 w-10 overflow-hidden rounded-full bg-slate-800">
                      <span
                        className="block h-full rounded-full bg-fuchsia-400"
                        style={{ width: `${(energy ?? 0) * 100}%` }}
                      />
                    </span>
                    <span className="font-mono text-xs text-fuchsia-300">
                      {energy === null ? '—' : energy.toFixed(2)}
                    </span>
                  </span>
                  <RatingStars rating={trackRating(track)} />
                  <span className="flex justify-end">
                    <button
                      type="button"
                      aria-label={`Add ${trackTitle(track)} to set`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleAdd(track)
                      }}
                      className={cn(
                        'flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1',
                        'text-xs font-medium text-slate-300 transition-colors',
                        'hover:border-cyan-400/60 hover:bg-cyan-400/15 hover:text-cyan-200',
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
