import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Pause, Play, Plus, Volume2, X } from 'lucide-react'
import { Artwork } from '@/components/Artwork'
import { cn } from '@/lib/utils'
import {
  MAX_PITCH_SEMITONES,
  MIN_PITCH_SEMITONES,
  trackAudioUrl,
} from '@/lib/api'
import {
  formatDuration,
  normalizedEnergy,
  trackArtist,
  trackBpm,
  trackKey,
  trackTitle,
  transposeKey,
} from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

function formatSemitones(semitones: number): string {
  if (semitones > 0) return `+${semitones}`
  return String(semitones)
}

function PitchShift({
  semitones,
  pending,
  disabled,
  onChange,
}: {
  semitones: number
  pending: boolean
  disabled: boolean
  onChange: (next: number) => void
}) {
  return (
    <div
      className="flex shrink-0 items-center rounded border border-slate-300 bg-white"
      title="Pitch shift in semitones. Tempo stays the same. One octave max."
    >
      <span className="border-r border-slate-300 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Pitch
      </span>
      <button
        type="button"
        onClick={() => onChange(semitones - 1)}
        disabled={disabled || semitones <= MIN_PITCH_SEMITONES}
        aria-label="Shift pitch down one semitone"
        className={cn(
          'flex size-6 items-center justify-center text-ink transition-colors',
          'hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
        )}
      >
        <Minus className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => onChange(0)}
        disabled={disabled}
        aria-label="Reset pitch"
        className="flex min-w-12 items-center justify-center gap-1 px-0.5 font-mono text-xs text-ink disabled:opacity-30"
      >
        {pending && <Loader2 className="size-3 animate-spin text-ink-muted" />}
        {formatSemitones(semitones)}
      </button>
      <button
        type="button"
        onClick={() => onChange(semitones + 1)}
        disabled={disabled || semitones >= MAX_PITCH_SEMITONES}
        aria-label="Shift pitch up one semitone"
        className={cn(
          'flex size-6 items-center justify-center text-ink transition-colors',
          'hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
        )}
      >
        <Plus className="size-3" />
      </button>
    </div>
  )
}

/**
 * Transport bar streaming the selected track's local file through the API.
 * Seeking relies on the server honouring HTTP Range requests.
 * Pitch buttons ask the API for a Rubber Band render, ±12 semitones, tempo fixed.
 */
export function AudioPlayer() {
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const setIsPlaying = useSetStore((state) => state.setIsPlaying)
  const stopPlayback = useSetStore((state) => state.stopPlayback)
  const mediaToken = useSetStore((state) => state.auth?.media_token ?? null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const isPlayingRef = useRef(isPlaying)
  const semitonesRef = useRef(0)
  const appliedSemitonesRef = useRef(0)
  const resumeAtRef = useRef<number | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)
  const [semitones, setSemitones] = useState(0)
  const [appliedSemitones, setAppliedSemitones] = useState(0)
  const [shifting, setShifting] = useState(false)

  isPlayingRef.current = isPlaying
  semitonesRef.current = semitones
  appliedSemitonesRef.current = appliedSemitones

  const trackId = playingTrack?.track_id ?? null
  const [loadedTrackId, setLoadedTrackId] = useState(trackId)

  // Reset the transport during render when a different track is loaded.
  if (trackId !== loadedTrackId) {
    setLoadedTrackId(trackId)
    setPosition(0)
    setDuration(0)
    setError(null)
    setSemitones(0)
    setAppliedSemitones(0)
    setShifting(false)
    semitonesRef.current = 0
    appliedSemitonesRef.current = 0
    resumeAtRef.current = null
  }

  // Rapid clicks settle on one render instead of shifting every intermediate step.
  useEffect(() => {
    if (semitones === appliedSemitones) return
    const handle = window.setTimeout(() => setAppliedSemitones(semitones), 250)
    return () => window.clearTimeout(handle)
  }, [semitones, appliedSemitones])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.play().catch((cause: unknown) => {
        setIsPlaying(false)
        setError(cause instanceof Error ? cause.message : 'Playback failed')
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, trackId, setIsPlaying])

  const changeSemitones = useCallback((next: number) => {
    const clamped = Math.min(MAX_PITCH_SEMITONES, Math.max(MIN_PITCH_SEMITONES, next))
    if (clamped === semitonesRef.current) return
    if (clamped === appliedSemitonesRef.current) {
      resumeAtRef.current = null
    } else if (resumeAtRef.current == null) {
      const audio = audioRef.current
      if (audio) resumeAtRef.current = audio.currentTime
    }
    setError(null)
    setSemitones(clamped)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  const handleSeek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    setPosition(seconds)
  }, [])

  if (!playingTrack) {
    return (
      <footer className="flex shrink-0 items-center gap-3 bg-theme px-4 py-2.5">
        <span className="text-xs text-ink-muted">
          Play a track, then shift its pitch here.
        </span>
        <PitchShift semitones={0} pending={false} disabled onChange={() => {}} />
      </footer>
    )
  }

  const effectiveDuration = duration || playingTrack.duration || 0
  const energy = normalizedEnergy(playingTrack)
  const bpm = trackBpm(playingTrack)
  const keyLabel = transposeKey(trackKey(playingTrack), semitones)
  const pitchPending = shifting || semitones !== appliedSemitones

  return (
    <footer className="flex shrink-0 items-center gap-2 overflow-x-auto bg-theme px-3 py-2.5 sm:gap-4 sm:px-4">
      <audio
        ref={audioRef}
        src={trackAudioUrl(playingTrack.track_id, mediaToken, appliedSemitones)}
        preload="metadata"
        onLoadStart={() => {
          if (appliedSemitones !== 0) setShifting(true)
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          setDuration(audio.duration || 0)
          const resumeAt = resumeAtRef.current
          if (resumeAt != null) {
            const limit = Number.isFinite(audio.duration)
              ? Math.max(audio.duration - 0.05, 0)
              : resumeAt
            audio.currentTime = Math.min(Math.max(resumeAt, 0), limit)
            resumeAtRef.current = null
          }
          if (isPlayingRef.current) {
            audio.play().catch((cause: unknown) => {
              setIsPlaying(false)
              setError(cause instanceof Error ? cause.message : 'Playback failed')
            })
          }
        }}
        onCanPlay={() => setShifting(false)}
        onTimeUpdate={(event) => {
          if (resumeAtRef.current != null) return
          setPosition(event.currentTarget.currentTime)
        }}
        onEnded={() => setIsPlaying(false)}
        onError={(event) => {
          setShifting(false)
          resumeAtRef.current = null
          if (event.currentTarget.error?.code === MediaError.MEDIA_ERR_ABORTED) return
          setError(
            appliedSemitones === 0
              ? 'Could not stream this file — check the API and file path.'
              : 'Pitch shift failed — check that rubberband is installed and the API is running.',
          )
        }}
      />

      <button
        type="button"
        onClick={() => setIsPlaying(!isPlaying)}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          'bg-accent text-white transition-colors hover:bg-accent-hover',
        )}
      >
        {isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
      </button>

      <Artwork
        trackId={playingTrack.track_id}
        title={trackTitle(playingTrack)}
        className="size-10"
      />

      <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
        <p className="truncate text-sm font-semibold text-ink">
          {trackTitle(playingTrack)}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {trackArtist(playingTrack)}
        </p>
      </div>

      <span className="hidden shrink-0 items-center gap-1.5 font-mono text-xs md:flex">
        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
          {bpm === null ? '—' : bpm.toFixed(1)}
        </span>
        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-slate-800">
          {keyLabel ?? '—'}
        </span>
        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-ink">
          {energy === null ? '—' : energy.toFixed(2)}
        </span>
      </span>

      <PitchShift
        semitones={semitones}
        pending={pitchPending}
        disabled={false}
        onChange={changeSemitones}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-ink-muted">
          {formatDuration(position)}
        </span>
        <input
          type="range"
          min={0}
          max={effectiveDuration || 1}
          step={0.1}
          value={Math.min(position, effectiveDuration || 1)}
          onChange={(event) => handleSeek(Number(event.target.value))}
          aria-label="Seek"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <span className="shrink-0 font-mono text-xs text-ink-faint">
          {formatDuration(effectiveDuration)}
        </span>
      </div>

      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        <Volume2 className="size-3.5 text-ink-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1 w-20 cursor-pointer accent-accent"
        />
      </div>

      {error && (
        <span className="max-w-56 shrink-0 truncate text-xs text-rose-500">
          {error}
        </span>
      )}

      <button
        type="button"
        onClick={stopPlayback}
        aria-label="Close player"
        className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </footer>
  )
}
