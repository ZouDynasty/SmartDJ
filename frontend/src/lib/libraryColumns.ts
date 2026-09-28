export const LIBRARY_COLUMNS_KEY = 'smartdj.libraryColumns'

export type LibraryColumn =
  | 'title'
  | 'artist'
  | 'genre'
  | 'bpm'
  | 'key'
  | 'energy'
  | 'rating'

export type LibraryColumnWidths = Record<LibraryColumn, number>

export const DEFAULT_COLUMN_WIDTHS: LibraryColumnWidths = {
  title: 300,
  artist: 200,
  genre: 150,
  bpm: 68,
  key: 60,
  energy: 104,
  rating: 92,
}

export const MIN_COLUMN_WIDTHS: LibraryColumnWidths = {
  title: 120,
  artist: 80,
  genre: 70,
  bpm: 48,
  key: 44,
  energy: 72,
  rating: 84,
}

export const MAX_COLUMN_WIDTH = 900

const PLAY_COLUMN_WIDTH = 32
const ADD_COLUMN_WIDTH = 84
/** Tailwind `gap-2` between grid columns and `px-3` on each row. */
const COLUMN_GAP = 8
const ROW_PADDING_X = 12

const COLUMN_ORDER: LibraryColumn[] = [
  'title',
  'artist',
  'genre',
  'bpm',
  'key',
  'energy',
  'rating',
]

export function clampColumnWidth(column: LibraryColumn, width: number): number {
  return Math.round(
    Math.min(Math.max(width, MIN_COLUMN_WIDTHS[column]), MAX_COLUMN_WIDTH),
  )
}

export function loadColumnWidths(): LibraryColumnWidths {
  const widths = { ...DEFAULT_COLUMN_WIDTHS }
  try {
    const raw = localStorage.getItem(LIBRARY_COLUMNS_KEY)
    if (!raw) return widths
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return widths
    const record = parsed as Partial<Record<LibraryColumn, unknown>>
    for (const column of COLUMN_ORDER) {
      const value = record[column]
      if (typeof value === 'number' && Number.isFinite(value)) {
        widths[column] = clampColumnWidth(column, value)
      }
    }
  } catch {
    /* fall back to defaults */
  }
  return widths
}

export function persistColumnWidths(widths: LibraryColumnWidths): void {
  localStorage.setItem(LIBRARY_COLUMNS_KEY, JSON.stringify(widths))
}

/**
 * Play button, the resizable columns, a flexible spacer that absorbs spare
 * width, then the Add button pinned to the right edge.
 */
export function columnGridTemplate(widths: LibraryColumnWidths): string {
  const sized = COLUMN_ORDER.map((column) => `${widths[column]}px`).join(' ')
  return `${PLAY_COLUMN_WIDTH}px ${sized} minmax(0,1fr) ${ADD_COLUMN_WIDTH}px`
}

/** Narrowest the table can get before it scrolls horizontally. */
export function columnMinTableWidth(widths: LibraryColumnWidths): number {
  const sized = COLUMN_ORDER.reduce((sum, column) => sum + widths[column], 0)
  const columnCount = COLUMN_ORDER.length + 3
  return (
    PLAY_COLUMN_WIDTH +
    sized +
    ADD_COLUMN_WIDTH +
    (columnCount - 1) * COLUMN_GAP +
    ROW_PADDING_X * 2
  )
}
