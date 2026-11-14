import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { getCompatible } from '@/lib/api'
import { endTrackDrag, setTrackDragData } from '@/lib/dragTrack'
import {
  BASE_COLUMNS,
  DEFAULT_COLUMN_WIDTHS,
  COLUMN_GAP,
  ROW_PADDING_X,
  clampColumnWidth,
  columnDividerOffsets,
  columnGridTemplate,
  columnMinTableWidth,
  loadColumnWidths,
  persistColumnWidths,
  type LibraryColumn,
  type LibraryColumnWidths,
} from '@/lib/libraryColumns'
import { cn } from '@/lib/utils'
import {
  camelotIndex,
  camelotRelation,
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
import type {
  CompatibilityScore,
  SortDirection,
  SortField,
  Track,
} from '@/types'

const ROW_HEIGHT = 32
const MAX_GENRE_TAGS = 16

type CompatibilityScores = Map<number, CompatibilityScore>

interface HeaderColumn {
  field: LibraryColumn & SortField
  label: string
}

/** Columns whose values sit against the right edge of their cell. */
const RIGHT_ALIGNED = new Set<LibraryColumn>(['bpm', 'key', 'energy', 'compatibility'])

/** Space beside the text in a cell: the title's duration, or nothing. */
const FIT_EXTRA: Partial<Record<LibraryColumn, number>> = { title: 56 }

/** Canvas font matching each text column, so widths fit what is drawn. */
const FIT_FONT_SIZE: Partial<Record<LibraryColumn, number>> = {
  title: 14,
  artist: 14,
  genre: 12,
}

/** Only shown while "Show compatible" is on. */
const COMPATIBILITY_COLUMN: HeaderColumn = {
  field: 'compatibility',
  label: 'Compatibility',
}

const COMPATIBILITY_COLUMNS: LibraryColumn[] = [...BASE_COLUMNS, 'compatibility']

function compatibilityBreakdown(score: CompatibilityScore): string {
  const part = (label: string, value: number) => `${label} ${value.toFixed(2)}`
  return [
    `Compatibility ${score.compatibility.toFixed(2)} — differences (0 = identical):`,
    [
      part('BPM', score.bpm_distance),
      part('Key', score.key_distance),
      part('Energy', score.energy_distance),
      part('Genre', score.genre_distance),
    ].join(' · '),
  ].join('\n')
}

const HEADER_COLUMNS: HeaderColumn[] = [
  { field: 'title', label: 'Title' },
  { field: 'artist', label: 'Artist' },
  { field: 'genre', label: 'Genre' },
  { field: 'bpm', label: 'BPM' },
  { field: 'key', label: 'Key' },
  { field: 'energy', label: 'Energy' },
  { field: 'rating', label: 'Rating' },
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

function compareTracks(
  a: Track,
  b: Track,
  field: SortField,
  scores: CompatibilityScores | null,
): number {
  switch (field) {
    case 'compatibility':
      return compareNumeric(
        scores?.get(a.track_id)?.compatibility ?? null,
        scores?.get(b.track_id)?.compatibility ?? null,
      )
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
  onSort,
  alignRight = false,
}: {
  field: SortField
  label: string
  active: boolean
  direction: SortDirection
  onSort: (field: SortField) => void
  alignRight?: boolean
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
        // Fills the whole header cell, so the full box is the click target.
        '-my-1.5 flex w-full items-center gap-0.5 py-1.5 uppercase tracking-wider transition-colors',
        alignRight && 'justify-end',
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

/** Drag the right edge of a header cell to resize; double-click resets it. */
function ColumnResizer({
  column,
  label,
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
  hideLine = false,
}: {
  column: LibraryColumn
  label: string
  width: number
  onResize: (column: LibraryColumn, width: number) => void
  onResizeEnd: () => void
  onAutoFit: (column: LibraryColumn) => void
  hideLine?: boolean
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title={`Drag to resize ${label} · double-click to fit`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onAutoFit(column)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startWidth = width
        document.body.classList.add('is-panel-resizing')
        document.body.style.cursor = 'col-resize'

        const onMove = (moveEvent: PointerEvent) => {
          onResize(column, startWidth + moveEvent.clientX - startX)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          document.body.classList.remove('is-panel-resizing')
          document.body.style.removeProperty('cursor')
          onResizeEnd()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }}
      className="group absolute -inset-y-2 -right-[13px] z-10 flex w-2.5 cursor-col-resize touch-none select-none justify-center"
    >
      <span
        className={cn(
          'h-full w-px transition-colors group-hover:w-0.5 group-hover:bg-accent group-active:w-0.5 group-active:bg-accent',
          hideLine ? 'bg-transparent' : 'bg-line',
        )}
      />
    </span>
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
              ? 'fill-accent text-accent-ink'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const [draggingTrackId, setDraggingTrackId] = useState<number | null>(null)
  const [columnWidths, setColumnWidths] =
    useState<LibraryColumnWidths>(loadColumnWidths)
  /** Latest widths, readable synchronously when a drag or reset ends. */
  const columnWidthsRef = useRef(columnWidths)

  const [showCompatible, setShowCompatible] = useState(false)

  /** Only the selected track can seed the ranking, and it needs a BPM and key. */
  const compatibleSeed = useMemo(() => {
    if (!selectedTrack || trackBpm(selectedTrack) === null) return null
    const relation = camelotRelation(trackKey(selectedTrack), trackKey(selectedTrack))
    return relation === null ? null : selectedTrack
  }, [selectedTrack])

  const rankedSeedId =
    showCompatible && compatibleSeed ? compatibleSeed.track_id : null
  const showRanking = rankedSeedId !== null

  const [ranking, setRanking] = useState<{
    seedId: number
    scores: CompatibilityScores
  } | null>(null)
  const [rankingError, setRankingError] = useState<string | null>(null)

  useEffect(() => {
    if (rankedSeedId === null) return
    const controller = new AbortController()
    setRankingError(null)
    getCompatible(rankedSeedId, controller.signal)
      .then((response) => {
        setRanking({
          seedId: response.track_id,
          scores: new Map(response.results.map((row) => [row.track_id, row])),
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRankingError(
          error instanceof Error ? error.message : 'Failed to rank compatible tracks.',
        )
      })
    return () => controller.abort()
  }, [rankedSeedId])

  const scores =
    ranking !== null && ranking.seedId === rankedSeedId ? ranking.scores : null
  const rankingLoading = showRanking && scores === null && rankingError === null

  /** Compatibility sorting only means something while the column is shown. */
  const activeSortField: SortField =
    sortField === 'compatibility' && !showRanking ? 'title' : sortField

  const visibleColumns = showRanking ? COMPATIBILITY_COLUMNS : BASE_COLUMNS
  const headerColumns = showRanking
    ? [...HEADER_COLUMNS, COMPATIBILITY_COLUMN]
    : HEADER_COLUMNS

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: columnGridTemplate(columnWidths, visibleColumns),
      columnGap: COLUMN_GAP,
      paddingLeft: ROW_PADDING_X,
      // The pinned Add column runs flush to the right edge so it can centre its button.
      paddingRight: 0,
      minWidth: columnMinTableWidth(columnWidths, visibleColumns),
    }),
    [columnWidths, visibleColumns],
  )
  const dividerOffsets = useMemo(
    () => columnDividerOffsets(columnWidths, visibleColumns),
    [columnWidths, visibleColumns],
  )

  const handleColumnResize = useCallback(
    (column: LibraryColumn, width: number) => {
      const current = columnWidthsRef.current
      const clamped = clampColumnWidth(column, width)
      if (current[column] === clamped) return
      const next = { ...current, [column]: clamped }
      columnWidthsRef.current = next
      setColumnWidths(next)
    },
    [],
  )

  const handleColumnResizeEnd = useCallback(() => {
    persistColumnWidths(columnWidthsRef.current)
  }, [])

  /** Fit a text column to its longest value; other columns return to their default. */
  const handleColumnAutoFit = useCallback(
    (column: LibraryColumn) => {
      const fontSize = FIT_FONT_SIZE[column]
      let width = DEFAULT_COLUMN_WIDTHS[column]
      if (fontSize !== undefined) {
        const context = document.createElement('canvas').getContext('2d')
        if (context) {
          const family = getComputedStyle(document.body).fontFamily
          context.font = `${fontSize}px ${family}`
          let longest = 0
          for (const track of catalog) {
            const text =
              column === 'title'
                ? trackTitle(track)
                : column === 'artist'
                  ? trackArtist(track)
                  : (trackGenre(track) ?? '')
            longest = Math.max(longest, context.measureText(text).width)
          }
          width = Math.ceil(longest) + (FIT_EXTRA[column] ?? 0) + 8
        }
      }
      handleColumnResize(column, width)
      handleColumnResizeEnd()
    },
    [catalog, handleColumnResize, handleColumnResizeEnd],
  )

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
      if (showRanking && !scores?.has(track.track_id)) return false
      if (needle.length === 0) return true
      return (
        trackTitle(track).toLowerCase().includes(needle) ||
        trackArtist(track).toLowerCase().includes(needle)
      )
    })
    const factor = sortDirection === 'asc' ? 1 : -1
    return filtered.sort(
      (a, b) => factor * compareTracks(a, b, activeSortField, scores),
    )
  }, [
    activeSortField,
    catalog,
    genreFilters,
    scores,
    searchQuery,
    showRanking,
    sortDirection,
  ])

  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === activeSortField) toggleSortDirection()
      else setSortField(field)
    },
    [activeSortField, setSortField, toggleSortDirection],
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
          <Disc3 className="size-4 text-accent-ink" />
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

        <div className="flex items-center gap-3 px-4 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
            {genreOptions.map(([genre, count]) => {
              const isActive = genreFilters.includes(genre)
              return (
                <button
                  key={genre}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleGenreFilter(genre)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
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
                className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
              >
                <X className="size-3" />
                Clear
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!compatibleSeed}
              title={
                compatibleSeed
                  ? `Rank tracks that mix with ${trackTitle(compatibleSeed)} — same or adjacent Camelot, BPM within 10%`
                  : selectedTrack
                    ? 'The selected track needs a BPM and key to find compatible tracks'
                    : 'Select a track first'
              }
              onClick={() => {
                const next = !showCompatible
                setShowCompatible(next)
                if (next) setSortField('compatibility')
              }}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight transition-colors',
                showCompatible && compatibleSeed
                  ? 'border-accent bg-accent text-on-accent shadow-sm shadow-accent/30'
                  : 'border-accent bg-theme-raised text-accent-ink hover:bg-theme',
                !compatibleSeed &&
                  'cursor-not-allowed border-line bg-raised text-ink-faint hover:bg-raised',
              )}
            >
              <Link2 className="size-3.5" />
              {showCompatible ? 'Showing compatible' : 'Show compatible'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div
          ref={headerScrollRef}
          className="shrink-0 overflow-hidden border-b border-line bg-[var(--color-sticky)] [background-image:linear-gradient(var(--color-raised),var(--color-raised))] [scrollbar-gutter:stable]"
        >
          <div
            className="grid items-center gap-4 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-ink-muted"
            style={gridStyle}
          >
            <span />
            {headerColumns.map(({ field, label }, columnIndex) => (
              <div
                key={field}
                className={cn(
                  'relative flex min-w-0 items-center',
                  RIGHT_ALIGNED.has(field) && 'justify-end',
                )}
              >
                <SortHeading
                  field={field}
                  label={label}
                  active={activeSortField === field}
                  direction={sortDirection}
                  onSort={handleSort}
                  alignRight={RIGHT_ALIGNED.has(field)}
                />
                <ColumnResizer
                  column={field}
                  label={label}
                  width={columnWidths[field]}
                  onResize={handleColumnResize}
                  onResizeEnd={handleColumnResizeEnd}
                  onAutoFit={handleColumnAutoFit}
                  hideLine={columnIndex === headerColumns.length - 1}
                />
              </div>
            ))}
            <span />
            <span className="sticky right-0 -my-1.5 self-stretch border-l border-line bg-[var(--color-sticky)] py-1.5 text-center [background-image:linear-gradient(var(--color-raised),var(--color-raised))]">
              Add
            </span>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const header = headerScrollRef.current
            if (header) header.scrollLeft = event.currentTarget.scrollLeft
          }}
          className="min-h-0 flex-1 overflow-auto bg-[var(--color-sticky)] [scrollbar-gutter:stable]"
        >
          {catalogStatus === 'idle' && (
            <p className="px-3 py-6 text-sm text-ink-muted">
              Sign in to load your library.
            </p>
          )}
          {catalogStatus === 'loading' && (
            <p className="px-3 py-6 text-sm text-ink-muted">Loading catalog…</p>
          )}
          {catalogStatus === 'error' && (
            <p className="px-3 py-6 text-sm text-danger">
              {catalogError ?? 'Failed to load the catalog.'}
            </p>
          )}
          {catalogStatus === 'ready' && rankingLoading && (
            <p className="px-3 py-6 text-sm text-ink-muted">
              Ranking compatible tracks…
            </p>
          )}
          {catalogStatus === 'ready' && showRanking && rankingError && (
            <p className="px-3 py-6 text-sm text-danger">{rankingError}</p>
          )}
          {catalogStatus === 'ready' &&
            !rankingLoading &&
            !(showRanking && rankingError) &&
            visibleTracks.length === 0 && (
            <p className="px-3 py-6 text-sm text-ink-muted">
              No tracks match the current filters.
            </p>
          )}

          <div
            className="relative w-full"
            style={{
              height: virtualizer.getTotalSize(),
              minWidth: gridStyle.minWidth,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const track = visibleTracks[virtualRow.index]
              const energy = normalizedEnergy(track)
              const bpm = trackBpm(track)
              const score = scores?.get(track.track_id) ?? null
              const isSelected = selectedTrack?.id === track.id
              const isPlayingRow =
                isPlaying && playingTrack?.track_id === track.track_id
              return (
                <div
                  key={`${track.id}-${track.track_id}`}
                  draggable
                  onDragStart={(event) => {
                    setTrackDragData(event.dataTransfer, track)
                    // Reselecting would re-seed the ranking and unmount this row mid-drag.
                    if (!showRanking) setSelectedTrack(track)
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
                    gridTemplateColumns: gridStyle.gridTemplateColumns,
                    columnGap: gridStyle.columnGap,
                    paddingLeft: gridStyle.paddingLeft,
                    paddingRight: gridStyle.paddingRight,
                  }}
                  className={cn(
                    'group/row grid cursor-grab items-center gap-4 border-b border-line/50 px-3 active:cursor-grabbing',
                    draggingTrackId === track.track_id
                      ? 'border border-dashed border-accent bg-transparent opacity-40'
                      : isSelected
                        ? 'bg-theme'
                        : cn(
                            virtualRow.index % 2 === 1 && 'bg-raised/70',
                            'hover:bg-raised',
                          ),
                  )}
                >
                  {dividerOffsets.slice(0, -1).map((left) => (
                    <span
                      key={left}
                      aria-hidden
                      className="pointer-events-none absolute top-0 -bottom-px w-px -translate-x-1/2 bg-line"
                      style={{ left }}
                    />
                  ))}
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
                        ? 'bg-accent text-on-accent'
                        : 'text-ink-muted hover:bg-theme hover:text-accent-ink',
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
                  <span className="text-right font-mono text-xs text-lagoon-700">
                    {bpm === null ? '—' : bpm.toFixed(1)}
                  </span>
                  <span className="text-right font-mono text-xs text-ink-muted">
                    {trackKey(track) ?? '—'}
                  </span>
                  <span className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
                    <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-canvas">
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
                  {showRanking && (
                    <span
                      className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden"
                      title={score ? compatibilityBreakdown(score) : undefined}
                    >
                      <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-canvas">
                        <span
                          className="block h-full rounded-full bg-ink"
                          style={{ width: `${(score?.compatibility ?? 0) * 100}%` }}
                        />
                      </span>
                      <span className="font-mono text-xs text-ink">
                        {score === null ? '—' : score.compatibility.toFixed(2)}
                      </span>
                    </span>
                  )}
                  <span />
                  <span
                    className={cn(
                      // Same tint stack as the row, over the same opaque base.
                      'sticky right-0 flex h-full items-center justify-center border-l border-line bg-[var(--color-sticky)]',
                      '[background-image:linear-gradient(var(--tint,transparent),var(--tint,transparent))]',
                      draggingTrackId !== track.track_id &&
                        (isSelected
                          ? '[--tint:var(--color-theme)]'
                          : cn(
                              virtualRow.index % 2 === 1 &&
                                '[--tint:color-mix(in_oklab,var(--color-raised)_70%,transparent)]',
                              'group-hover/row:[--tint:var(--color-raised)]',
                            )),
                    )}
                  >
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
                        'flex h-6 w-9 items-center justify-center rounded-md border border-line bg-raised',
                        'text-ink-muted transition-colors',
                        'hover:border-accent hover:bg-theme hover:text-ink',
                      )}
                    >
                      <Plus className="size-3.5" />
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
