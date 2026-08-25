/** Rekordbox `<TEMPO>` beatgrid marker. */
export interface TempoMarker {
  inizio: number | null
  bpm: number | null
  metro: string | null
  battito: number | null
}

/** Rekordbox `<POSITION_MARK>` cue / loop. */
export interface CuePoint {
  name: string | null
  type: number | null
  start: number | null
  end: number | null
  num: number | null
  red: number | null
  green: number | null
  blue: number | null
}

/** Library track — mirrors the SQLite `tracks` columns served by `/api/tracks`. */
export interface Track {
  id: number
  track_id: number
  file_path: string | null
  title: string | null
  artist: string | null
  composer: string | null
  album: string | null
  grouping: string | null
  genre: string | null
  clean_genre: string | null
  macro_genre: string | null
  kind: string | null
  size: number | null
  duration: number | null
  disc_number: number | null
  track_number: number | null
  year: number | null
  bpm: number | null
  date_added: string | null
  bitrate: number | null
  sample_rate: number | null
  comments: string | null
  play_count: number | null
  /** Rekordbox stars, either 0–5 or 0–255 (51 per star). */
  rating: number | null
  remixer: string | null
  /** Musical key as Rekordbox writes it, e.g. `F minor`. */
  key: string | null
  camelot_key: string | null
  label: string | null
  mix: string | null
  colour: string | null
  date_modified: string | null
  energy_score: number | null
  cue_points: CuePoint[]
  /** Beatgrid is large, so it only ships with `/api/tracks/{track_id}`. */
  tempo_markers?: TempoMarker[]
}

/** Playlist or folder — mirrors SQLite `playlists` / `playlist_tracks`. */
export interface Playlist {
  playlist_id: number
  name: string
  parent_id: number | null
  is_folder: boolean
  path: string
  track_ids: number[]
}

/** One occurrence of a track in the live set queue. */
export interface SetItem {
  instance_id: string
  track: Track
  cue_points: CuePoint[]
}

export interface Recommendation {
  track: Track
  score: number | null
}

/** Which metric lines the set trajectory graph renders. */
export type MetricView = 'all' | 'bpm' | 'energy' | 'key'

/** Catalog sort field exposed by the "Select by" dropdown. */
export type SortField = 'title' | 'artist' | 'genre' | 'bpm' | 'key' | 'energy' | 'rating'

export type SortDirection = 'asc' | 'desc'
