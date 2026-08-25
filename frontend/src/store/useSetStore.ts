import { create } from 'zustand'
import type {
  MetricView,
  SetItem,
  SortDirection,
  SortField,
  Track,
} from '@/types'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8
const ZOOM_STEP = 1.5

function createInstanceId(trackId: number): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return `${trackId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

/** Where a hover originated, so only graph hovers auto-scroll the queue. */
export type HighlightSource = 'graph' | 'queue' | null

interface SetStore {
  /** Full library catalog backing the bottom table. */
  catalog: Track[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogError: string | null

  /** Ordered live set. */
  activeQueue: SetItem[]
  selectedTrack: Track | null
  /** Shared hover target for graph <-> queue cross-highlighting. */
  highlightedInstanceId: string | null
  highlightSource: HighlightSource

  /** Track loaded in the transport bar, streamed from its local file. */
  playingTrack: Track | null
  isPlaying: boolean

  /** Graph controls. */
  zoom: number
  metricView: MetricView

  /** Catalog toolbar. */
  searchQuery: string
  sortField: SortField
  sortDirection: SortDirection
  genreFilters: string[]

  setCatalog: (tracks: Track[]) => void
  setCatalogStatus: (status: SetStore['catalogStatus']) => void
  setCatalogError: (message: string | null) => void

  setActiveQueue: (queue: SetItem[]) => void
  addTrackToSet: (track: Track) => void
  removeSetItem: (instanceId: string) => void
  moveSetItem: (fromIndex: number, toIndex: number) => void
  clearSet: () => void

  setSelectedTrack: (track: Track | null) => void
  setHighlight: (instanceId: string | null, source?: HighlightSource) => void

  /** Play a track, or toggle pause when it is already loaded. */
  playTrack: (track: Track) => void
  setIsPlaying: (playing: boolean) => void
  stopPlayback: () => void

  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setMetricView: (view: MetricView) => void

  setSearchQuery: (query: string) => void
  setSortField: (field: SortField) => void
  setSortDirection: (direction: SortDirection) => void
  toggleSortDirection: () => void
  toggleGenreFilter: (genre: string) => void
  clearGenreFilters: () => void
}

export const useSetStore = create<SetStore>()((set) => ({
  catalog: [],
  catalogStatus: 'idle',
  catalogError: null,

  activeQueue: [],
  selectedTrack: null,
  highlightedInstanceId: null,
  highlightSource: null,

  playingTrack: null,
  isPlaying: false,

  zoom: MIN_ZOOM,
  metricView: 'all',

  searchQuery: '',
  sortField: 'title',
  sortDirection: 'asc',
  genreFilters: [],

  setCatalog: (tracks) => set({ catalog: tracks }),
  setCatalogStatus: (status) => set({ catalogStatus: status }),
  setCatalogError: (message) => set({ catalogError: message }),

  setActiveQueue: (queue) => set({ activeQueue: queue }),

  addTrackToSet: (track) =>
    set((state) => ({
      activeQueue: [
        ...state.activeQueue,
        {
          instance_id: createInstanceId(track.track_id),
          track,
          cue_points: track.cue_points ?? [],
        },
      ],
    })),

  removeSetItem: (instanceId) =>
    set((state) => ({
      activeQueue: state.activeQueue.filter(
        (item) => item.instance_id !== instanceId,
      ),
      highlightedInstanceId:
        state.highlightedInstanceId === instanceId
          ? null
          : state.highlightedInstanceId,
      highlightSource:
        state.highlightedInstanceId === instanceId ? null : state.highlightSource,
    })),

  moveSetItem: (fromIndex, toIndex) =>
    set((state) => {
      const queue = state.activeQueue
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= queue.length ||
        toIndex >= queue.length
      ) {
        return {}
      }
      const next = [...queue]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return { activeQueue: next }
    }),

  clearSet: () =>
    set({ activeQueue: [], highlightedInstanceId: null, highlightSource: null }),

  setSelectedTrack: (track) => set({ selectedTrack: track }),
  setHighlight: (instanceId, source = null) =>
    set((state) =>
      state.highlightedInstanceId === instanceId &&
      state.highlightSource === source
        ? {}
        : {
            highlightedInstanceId: instanceId,
            highlightSource: instanceId === null ? null : source,
          },
    ),

  playTrack: (track) =>
    set((state) =>
      state.playingTrack?.track_id === track.track_id
        ? { isPlaying: !state.isPlaying }
        : { playingTrack: track, isPlaying: true },
    ),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  stopPlayback: () => set({ playingTrack: null, isPlaying: false }),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom * ZOOM_STEP) })),
  zoomOut: () => set((state) => ({ zoom: clampZoom(state.zoom / ZOOM_STEP) })),
  resetZoom: () => set({ zoom: MIN_ZOOM }),
  setMetricView: (view) => set({ metricView: view }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortField: (field) => set({ sortField: field }),
  setSortDirection: (direction) => set({ sortDirection: direction }),
  toggleSortDirection: () =>
    set((state) => ({
      sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
    })),

  toggleGenreFilter: (genre) =>
    set((state) => ({
      genreFilters: state.genreFilters.includes(genre)
        ? state.genreFilters.filter((item) => item !== genre)
        : [...state.genreFilters, genre],
    })),

  clearGenreFilters: () => set({ genreFilters: [] }),
}))
