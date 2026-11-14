import { create } from 'zustand'
import { setTrackRating } from '@/lib/api'
import { deleteSavedSetRow, upsertSavedSets } from '@/lib/savedSets'
import type {
  AuthStatus,
  MetricView,
  SavedSet,
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

const MAX_HISTORY = 50

/** Loads `track` in the transport, remembering the track it replaces for Back. */
function switchTo(
  state: { playingTrack: Track | null; playHistory: Track[] },
  track: Track,
): { playingTrack: Track; playHistory: Track[] } {
  const previous = state.playingTrack
  const playHistory =
    previous && previous.track_id !== track.track_id
      ? [...state.playHistory, previous].slice(-MAX_HISTORY)
      : state.playHistory
  return { playingTrack: track, playHistory }
}

/** Random track from the pool, never the one just played unless it is the only one. */
function pickRandomTrack(pool: Track[], current: Track | null): Track | null {
  const choices = pool.filter((track) => track.track_id !== current?.track_id)
  if (choices.length === 0) return null
  return choices[Math.floor(Math.random() * choices.length)]
}

function createSetItem(track: Track): SetItem {
  return {
    instance_id: createInstanceId(track.track_id),
    track,
    cue_points: track.cue_points ?? [],
  }
}

function queueFromSaved(trackIds: number[], catalog: Track[]): SetItem[] {
  const catalogById = new Map(catalog.map((track) => [track.track_id, track]))
  return trackIds.flatMap((trackId) => {
    const track = catalogById.get(trackId)
    return track ? [createSetItem(track)] : []
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

/** Where a hover originated, so only graph hovers auto-scroll the queue. */
export type HighlightSource = 'graph' | 'queue' | null

interface SetStore {
  /** Null until `/auth/me` answers. The library is only fetched once signed in. */
  auth: AuthStatus | null

  /** Full library catalog backing the bottom table. */
  catalog: Track[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogError: string | null
  /** Bumped when an import writes the library, so the catalog is fetched again. */
  libraryVersion: number
  /** Library setup dialog, opened on first sign-in or from the account menu. */
  setupOpen: boolean

  /** The two player slots. Each holds its own track; emptying one leaves the other put. */
  decks: [Track | null, Track | null]
  /** Ordered live set. */
  activeQueue: SetItem[]
  /** Mirror of the user's Supabase `saved_sets` rows, newest first. */
  savedSets: SavedSet[]
  /** Last failed Supabase read or write of saved sets. */
  savedSetsError: string | null
  /** Set last saved or loaded; null while the queue is an unnamed draft. */
  loadedSetId: string | null
  selectedTrack: Track | null
  /** Shared hover target for graph <-> queue cross-highlighting. */
  highlightedInstanceId: string | null
  highlightSource: HighlightSource

  /** Track loaded in the transport bar, streamed from its local file. */
  playingTrack: Track | null
  isPlaying: boolean
  /** When on, a finished track is followed by a random one from `shufflePool`. */
  shuffleOn: boolean
  /** What shuffle draws from: the library as currently filtered. */
  shufflePool: Track[]
  /** Tracks played before the current one, oldest first, for the Back button. */
  playHistory: Track[]

  /** Graph controls. */
  zoom: number
  metricView: MetricView

  /** Catalog toolbar. */
  searchQuery: string
  sortField: SortField
  sortDirection: SortDirection
  genreFilters: string[]

  setAuth: (auth: AuthStatus) => void
  /** Drop everything loaded from the library, e.g. on sign-out. */
  clearLibrary: () => void

  setCatalog: (tracks: Track[]) => void
  setCatalogStatus: (status: SetStore['catalogStatus']) => void
  setCatalogError: (message: string | null) => void
  bumpLibraryVersion: () => void
  /** Rate a track 0–5 stars; shown at once, saved in the background. */
  rateTrack: (trackId: number, stars: number) => void
  setSetupOpen: (open: boolean) => void

  setActiveQueue: (queue: SetItem[]) => void
  /** Put a track in one player slot, or empty it with `null`. */
  setDeck: (index: 0 | 1, track: Track | null) => void
  /**
   * Drop a track on a player. If it replaces the track loaded in the transport,
   * the new one takes over: from the start if that was playing, paused if not.
   */
  dropOnDeck: (index: 0 | 1, track: Track) => void
  /** Add a Dijkstra route to the set: start and goal if missing, intermediates between. */
  insertMixPath: (pathTracks: Track[]) => void
  /** Appends the track, or inserts it at `index` when given. */
  addTrackToSet: (track: Track, index?: number) => void
  removeSetItem: (instanceId: string) => void
  moveSetItem: (fromIndex: number, toIndex: number) => void
  clearSet: () => void
  setSavedSets: (sets: SavedSet[]) => void
  setSavedSetsError: (message: string | null) => void
  /** Persist the current queue under ``name``. Same name overwrites. */
  saveSet: (name: string) => void
  loadSavedSet: (id: string) => void
  deleteSavedSet: (id: string) => void

  setSelectedTrack: (track: Track | null) => void
  setHighlight: (instanceId: string | null, source?: HighlightSource) => void

  /** Play a track, or toggle pause when it is already loaded. */
  playTrack: (track: Track) => void
  setIsPlaying: (playing: boolean) => void
  stopPlayback: () => void
  setShufflePool: (tracks: Track[]) => void
  /** Turn shuffle on or off; turning it on with nothing loaded starts a track. */
  toggleShuffle: () => void
  /** Called when a track finishes: continues with a random track or stops. */
  handleTrackEnded: () => void
  /** Next track: random while shuffling, otherwise the next row of the filtered library. */
  skipTrack: () => void
  /** Go back to the track played before this one. */
  playPrevious: () => void

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

export const useSetStore = create<SetStore>()((set, get) => ({
  auth: null,
  decks: [null, null],

  catalog: [],
  catalogStatus: 'idle',
  catalogError: null,
  libraryVersion: 0,
  setupOpen: false,

  activeQueue: [],
  savedSets: [],
  savedSetsError: null,
  loadedSetId: null,
  selectedTrack: null,
  highlightedInstanceId: null,
  highlightSource: null,

  playingTrack: null,
  isPlaying: false,
  shuffleOn: false,
  shufflePool: [],
  playHistory: [],

  zoom: MIN_ZOOM,
  metricView: 'all',

  searchQuery: '',
  sortField: 'title',
  sortDirection: 'asc',
  genreFilters: [],

  setAuth: (auth) => set({ auth }),
  clearLibrary: () =>
    set({
      catalog: [],
      catalogStatus: 'idle',
      catalogError: null,
      decks: [null, null],
      activeQueue: [],
      savedSets: [],
      savedSetsError: null,
      loadedSetId: null,
      selectedTrack: null,
      highlightedInstanceId: null,
      highlightSource: null,
      playingTrack: null,
      isPlaying: false,
      shuffleOn: false,
      shufflePool: [],
      playHistory: [],
    }),

  setCatalog: (tracks) =>
    set((state) => {
      const saved = state.loadedSetId
        ? state.savedSets.find((entry) => entry.id === state.loadedSetId)
        : null
      return {
        catalog: tracks,
        activeQueue: saved
          ? queueFromSaved(saved.track_ids, tracks)
          : state.activeQueue,
      }
    }),
  setCatalogStatus: (status) => set({ catalogStatus: status }),
  setCatalogError: (message) => set({ catalogError: message }),
  bumpLibraryVersion: () =>
    set((state) => ({ libraryVersion: state.libraryVersion + 1 })),
  rateTrack: (trackId, stars) => {
    // Rekordbox keeps ratings as 0–255, 51 per star.
    const apply = (rating: number) => {
      const update = (track: Track) =>
        track.track_id === trackId ? { ...track, rating } : track
      set((state) => ({
        catalog: state.catalog.map(update),
        decks: state.decks.map((track) =>
          track ? update(track) : track,
        ) as [Track | null, Track | null],
        selectedTrack: state.selectedTrack ? update(state.selectedTrack) : null,
      }))
    }
    const previous = get().catalog.find((track) => track.track_id === trackId)
    const previousRating = previous?.rating ?? 0
    apply(stars * 51)
    setTrackRating(trackId, stars).catch((cause: unknown) => {
      apply(previousRating)
      console.error('Could not save rating', cause)
    })
  },

  setSetupOpen: (open) => set({ setupOpen: open }),

  setActiveQueue: (queue) => set({ activeQueue: queue }),

  setDeck: (index, track) =>
    set((state) => {
      const previous = state.decks[index]
      const decks: [Track | null, Track | null] = [...state.decks]
      decks[index] = track
      // Removing the loaded track also stops it if it is the one playing.
      const removedPlaying =
        track === null &&
        previous !== null &&
        state.playingTrack?.track_id === previous.track_id
      return removedPlaying
        ? { decks, playingTrack: null, isPlaying: false, shuffleOn: false }
        : { decks }
    }),

  dropOnDeck: (index, track) =>
    set((state) => {
      const previous = state.decks[index]
      const decks: [Track | null, Track | null] = [...state.decks]
      decks[index] = track
      const replacesLoaded =
        previous !== null &&
        previous.track_id !== track.track_id &&
        state.playingTrack?.track_id === previous.track_id
      return replacesLoaded ? { decks, ...switchTo(state, track) } : { decks }
    }),

  insertMixPath: (pathTracks) =>
    set((state) => {
      if (pathTracks.length < 2) return {}
      const start = pathTracks[0]
      const goal = pathTracks[pathTracks.length - 1]
      const middles = pathTracks.slice(1, -1).map(createSetItem)
      const queue = [...state.activeQueue]
      const indexOf = (track: Track) =>
        queue.findIndex((item) => item.track.track_id === track.track_id)

      let startIndex = indexOf(start)
      if (startIndex < 0) {
        queue.push(createSetItem(start))
        startIndex = queue.length - 1
      }
      queue.splice(startIndex + 1, 0, ...middles)
      if (indexOf(goal) < 0) {
        queue.splice(startIndex + 1 + middles.length, 0, createSetItem(goal))
      }

      return {
        activeQueue: queue,
        loadedSetId: null,
        highlightedInstanceId: null,
        highlightSource: null,
      }
    }),

  addTrackToSet: (track, index) =>
    set((state) => {
      const queue = [...state.activeQueue]
      const at =
        index === undefined
          ? queue.length
          : Math.min(Math.max(index, 0), queue.length)
      queue.splice(at, 0, createSetItem(track))
      return { activeQueue: queue }
    }),

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
    set({
      activeQueue: [],
      loadedSetId: null,
      highlightedInstanceId: null,
      highlightSource: null,
    }),

  setSavedSets: (sets) => set({ savedSets: sets, savedSetsError: null }),
  setSavedSetsError: (message) => set({ savedSetsError: message }),

  saveSet: (name) =>
    set((state) => {
      const trimmed = name.trim()
      if (!trimmed || state.activeQueue.length === 0) return {}
      const trackIds = state.activeQueue.map((item) => item.track.track_id)
      const existing = state.savedSets.find(
        (entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
      )
      const record: SavedSet = {
        // The `saved_sets.id` column is a UUID.
        id: existing?.id ?? crypto.randomUUID(),
        name: trimmed,
        track_ids: trackIds,
        saved_at: new Date().toISOString(),
      }
      const savedSets = existing
        ? state.savedSets.map((entry) =>
            entry.id === existing.id ? record : entry,
          )
        : [record, ...state.savedSets]
      upsertSavedSets([record]).catch((error: unknown) => {
        set({ savedSetsError: `Save failed: ${errorMessage(error)}` })
      })
      return { savedSets, savedSetsError: null, loadedSetId: record.id }
    }),

  loadSavedSet: (id) =>
    set((state) => {
      const saved = state.savedSets.find((entry) => entry.id === id)
      if (!saved) return {}
      return {
        activeQueue: queueFromSaved(saved.track_ids, state.catalog),
        loadedSetId: id,
        highlightedInstanceId: null,
        highlightSource: null,
      }
    }),

  deleteSavedSet: (id) =>
    set((state) => {
      const savedSets = state.savedSets.filter((entry) => entry.id !== id)
      deleteSavedSetRow(id).catch((error: unknown) => {
        set({ savedSetsError: `Delete failed: ${errorMessage(error)}` })
      })
      return {
        savedSets,
        savedSetsError: null,
        loadedSetId: state.loadedSetId === id ? null : state.loadedSetId,
      }
    }),

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
        : { ...switchTo(state, track), isPlaying: true },
    ),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  stopPlayback: () =>
    set({ playingTrack: null, isPlaying: false, shuffleOn: false }),

  setShufflePool: (tracks) => set({ shufflePool: tracks }),

  toggleShuffle: () =>
    set((state) => {
      if (state.shuffleOn) return { shuffleOn: false }
      // Playing or paused already: let it finish, then shuffle takes over.
      if (state.playingTrack) return { shuffleOn: true }
      const next = pickRandomTrack(state.shufflePool, null)
      return next
        ? { shuffleOn: true, ...switchTo(state, next), isPlaying: true }
        : {}
    }),

  handleTrackEnded: () =>
    set((state) => {
      if (!state.shuffleOn) return { isPlaying: false }
      const next = pickRandomTrack(state.shufflePool, state.playingTrack)
      return next
        ? { ...switchTo(state, next), isPlaying: true }
        : { isPlaying: false }
    }),

  skipTrack: () =>
    set((state) => {
      const current = state.playingTrack
      if (!current) return {}
      let next: Track | null
      if (state.shuffleOn) {
        next = pickRandomTrack(state.shufflePool, current)
      } else {
        const index = state.shufflePool.findIndex(
          (track) => track.track_id === current.track_id,
        )
        next = state.shufflePool[index + 1] ?? null
      }
      return next ? { ...switchTo(state, next), isPlaying: true } : {}
    }),

  playPrevious: () =>
    set((state) => {
      const previous = state.playHistory[state.playHistory.length - 1]
      if (!previous) return {}
      return {
        playingTrack: previous,
        playHistory: state.playHistory.slice(0, -1),
        isPlaying: true,
      }
    }),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom * ZOOM_STEP) })),
  zoomOut: () => set((state) => ({ zoom: clampZoom(state.zoom / ZOOM_STEP) })),
  resetZoom: () => set({ zoom: MIN_ZOOM }),
  setMetricView: (view) => set({ metricView: view }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortField: (field) =>
    set({
      sortField: field,
      sortDirection: field === 'compatibility' ? 'desc' : 'asc',
    }),
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
