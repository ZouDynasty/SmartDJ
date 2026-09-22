import type { SetItem, Track } from '@/types'

/** Camelot wheel as 24 ticks in alternating harmonic pairs (1A, 1B, 2A, ...). */
export const CAMELOT_KEYS = [
  '1A',
  '1B',
  '2A',
  '2B',
  '3A',
  '3B',
  '4A',
  '4B',
  '5A',
  '5B',
  '6A',
  '6B',
  '7A',
  '7B',
  '8A',
  '8B',
  '9A',
  '9B',
  '10A',
  '10B',
  '11A',
  '11B',
  '12A',
  '12B',
] as const

/** Library energy is stored 0–10; the graph plots a normalized 0.0–1.0 float. */
export const ENERGY_SCALE_MAX = 10

/** Tracks with no duration still need a slot on the timeline. */
export const FALLBACK_DURATION_SEC = 210

const CAMELOT_INDEX = new Map<string, number>(
  CAMELOT_KEYS.map((key, index) => [key, index]),
)

export function camelotIndex(key: string | null): number | null {
  if (!key) return null
  const normalized = key.trim().toUpperCase().replace(/\s+/g, '')
  return CAMELOT_INDEX.get(normalized) ?? null
}

export function camelotLabel(index: number): string {
  return CAMELOT_KEYS[Math.round(index)] ?? ''
}

interface CamelotParts {
  number: number
  mode: 'A' | 'B'
}

function parseCamelot(key: string | null): CamelotParts | null {
  if (!key) return null
  const match = /^(\d{1,2})([AB])$/.exec(key.trim().toUpperCase())
  if (!match) return null
  const number = Number(match[1])
  if (number < 1 || number > 12) return null
  return { number, mode: match[2] as 'A' | 'B' }
}

export interface CamelotRelation {
  label: string
  /** True for the moves that stay harmonically safe on the wheel. */
  compatible: boolean
}

/** How two Camelot keys relate on the wheel, for transition readouts. */
export function camelotRelation(
  from: string | null,
  to: string | null,
): CamelotRelation | null {
  const a = parseCamelot(from)
  const b = parseCamelot(to)
  if (!a || !b) return null

  const raw = Math.abs(a.number - b.number)
  const steps = Math.min(raw, 12 - raw)

  if (a.number === b.number && a.mode === b.mode) {
    return { label: 'Same key', compatible: true }
  }
  if (a.number === b.number) {
    return { label: 'Relative major/minor', compatible: true }
  }
  if (a.mode === b.mode && steps === 1) {
    return { label: 'Adjacent on wheel', compatible: true }
  }
  if (a.mode === b.mode) {
    return { label: `${steps} steps apart`, compatible: false }
  }
  return { label: `${steps} steps + mode flip`, compatible: false }
}

/** Mix window used by the catalog filter and the candidate retriever. */
export const COMPATIBLE_BPM_TOLERANCE = 0.1

/** True when BPM is within 10%, including half-time and double-time. */
export function bpmCompatible(
  fromBpm: number | null,
  toBpm: number | null,
  tolerance: number = COMPATIBLE_BPM_TOLERANCE,
): boolean {
  if (fromBpm === null || toBpm === null || fromBpm <= 0) return false
  const direct = Math.abs(fromBpm - toBpm) / fromBpm
  const doubleTime = Math.abs(fromBpm - 2 * toBpm) / fromBpm
  const halfTime = Math.abs(fromBpm - 0.5 * toBpm) / fromBpm
  return Math.min(direct, doubleTime, halfTime) <= tolerance
}

/** Harmonic + tempo legal: same/relative/adjacent Camelot and a mixable BPM. */
export function isMixCompatible(from: Track, to: Track): boolean {
  const relation = camelotRelation(trackKey(from), trackKey(to))
  if (relation === null || !relation.compatible) return false
  return bpmCompatible(trackBpm(from), trackBpm(to))
}

/** The Now Playing / Up Next pair shown in the transport strip. */
export interface NowNextPair {
  current: Track | null
  next: Track | null
  /** Queue index of the current track, or -1 when it is not in the set. */
  currentIndex: number
  /** Queue index of the next track, or -1 when Up Next is empty. */
  nextIndex: number
  currentInstanceId: string | null
  nextInstanceId: string | null
}

/**
 * Same pairing the Now / Next panel uses: a playing queue track plus the
 * song after it, or a catalog preview plus the head of the set.
 */
export function resolveNowNext(
  queue: SetItem[],
  playingTrack: Track | null,
): NowNextPair {
  const queueIndex = playingTrack
    ? queue.findIndex((item) => item.track.track_id === playingTrack.track_id)
    : -1

  if (queueIndex >= 0) {
    const current = queue[queueIndex]
    const following = queue[queueIndex + 1]
    return {
      current: current.track,
      next: following?.track ?? null,
      currentIndex: queueIndex,
      nextIndex: following ? queueIndex + 1 : -1,
      currentInstanceId: current.instance_id,
      nextInstanceId: following?.instance_id ?? null,
    }
  }

  const head = queue[0]
  return {
    current: playingTrack,
    next: head?.track ?? null,
    currentIndex: -1,
    nextIndex: head ? 0 : -1,
    currentInstanceId: null,
    nextInstanceId: head?.instance_id ?? null,
  }
}

export function trackTitle(track: Track): string {
  return track.title?.trim() || 'Untitled'
}

export function trackArtist(track: Track): string {
  return track.artist?.trim() || 'Unknown artist'
}

export function trackBpm(track: Track): number | null {
  const bpm = track.bpm
  if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return null
  return bpm
}

/** Camelot drives the graph; the raw Rekordbox key is the display fallback. */
export function trackKey(track: Track): string | null {
  return track.camelot_key?.trim() || track.key?.trim() || null
}

export function trackGenre(track: Track): string | null {
  return (
    track.macro_genre?.trim() ||
    track.clean_genre?.trim() ||
    track.genre?.trim() ||
    null
  )
}

/** Raw 0–10 energy as stored in SQLite. */
export function trackEnergy(track: Track): number | null {
  return track.energy_score ?? null
}

/** Energy normalized to the 0.0–1.0 chart scale. */
export function normalizedEnergy(track: Track): number | null {
  const energy = trackEnergy(track)
  if (energy === null) return null
  return Math.min(Math.max(energy / ENERGY_SCALE_MAX, 0), 1)
}

/**
 * Rekordbox writes ratings either as 0–5 stars or as 0–255 (51 per star).
 * Normalize both to 0–5.
 */
export function trackRating(track: Track): number {
  const rating = track.rating
  if (rating === null || !Number.isFinite(rating) || rating <= 0) return 0
  const stars = rating > 5 ? Math.round(rating / 51) : Math.round(rating)
  return Math.min(Math.max(stars, 0), 5)
}

export function trackDuration(track: Track): number {
  const duration = track.duration
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return FALLBACK_DURATION_SEC
  }
  return duration
}

/** Format seconds as `mm:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const paddedSecs = String(secs).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSecs}`
  }
  return `${minutes}:${paddedSecs}`
}

/** One plotted track: cumulative position plus every charted metric. */
export interface SetPoint {
  instanceId: string
  trackId: number
  index: number
  title: string
  artist: string
  keyLabel: string
  /** Cumulative seconds before this track starts. */
  startSec: number
  durationSec: number
  /** Temporal midpoint in seconds: sum(previous durations) + duration / 2. */
  midpointSec: number
  bpm: number | null
  /** Normalized 0.0–1.0. */
  energy: number | null
  /** Raw 0–10 energy for tooltips. */
  energyRaw: number | null
  keyIndex: number | null
}

/**
 * Lay the queue out on the time axis. Each point sits at its temporal
 * midpoint, so a track spans `startSec` to `startSec + durationSec`.
 */
export function buildSetPoints(queue: SetItem[]): SetPoint[] {
  let elapsed = 0
  return queue.map((item, index) => {
    const durationSec = trackDuration(item.track)
    const startSec = elapsed
    elapsed += durationSec
    return {
      instanceId: item.instance_id,
      trackId: item.track.track_id,
      index,
      title: trackTitle(item.track),
      artist: trackArtist(item.track),
      keyLabel: trackKey(item.track) ?? '—',
      startSec,
      durationSec,
      midpointSec: startSec + durationSec / 2,
      bpm: trackBpm(item.track),
      energy: normalizedEnergy(item.track),
      energyRaw: trackEnergy(item.track),
      keyIndex: camelotIndex(trackKey(item.track)),
    }
  })
}

export function totalSetDuration(queue: SetItem[]): number {
  return queue.reduce((sum, item) => sum + trackDuration(item.track), 0)
}

/** Padded BPM domain fitted to the set, or a sane default when empty. */
export function bpmDomain(points: SetPoint[]): [number, number] {
  const values = points
    .map((point) => point.bpm)
    .filter((bpm): bpm is number => bpm !== null)
  if (values.length === 0) return [60, 180]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    return [Math.max(0, min - 8), max + 8]
  }
  const padding = Math.max((max - min) * 0.15, 2)
  return [Math.floor(min - padding), Math.ceil(max + padding)]
}
