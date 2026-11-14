import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume2, X } from 'lucide-react'
import { Artwork } from '@/components/Artwork'
import { Visualizer } from '@/components/Visualizer'
import { cn } from '@/lib/utils'
import { trackAudioUrl } from '@/lib/api'
import {
  formatDuration,
  normalizedEnergy,
  trackArtist,
  trackBpm,
  trackKey,
  trackTitle,
} from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

/**
 * Transport bar streaming the selected track's local file through the API.
 * Seeking relies on the server honouring HTTP Range requests.
 */
export function AudioPlayer() {
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const setIsPlaying = useSetStore((state) => state.setIsPlaying)
  const stopPlayback = useSetStore((state) => state.stopPlayback)
  const mediaToken = useSetStore((state) => state.auth?.media_token ?? null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const isPlayingRef = useRef(isPlaying)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)

  isPlayingRef.current = isPlaying

  const trackId = playingTrack?.track_id ?? null
  const [loadedTrackId, setLoadedTrackId] = useState(trackId)

  // Reset the transport during render when a different track is loaded.
  if (trackId !== loadedTrackId) {
    setLoadedTrackId(trackId)
    setPosition(0)
    setDuration(0)
    setError(null)
  }

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
        <span className="text-xs text-ink-muted">Play a track to start.</span>
      </footer>
    )
  }

  const effectiveDuration = duration || playingTrack.duration || 0
  const energy = normalizedEnergy(playingTrack)
  const bpm = trackBpm(playingTrack)
  const keyLabel = trackKey(playingTrack)

  return (
    <footer className="flex shrink-0 items-center gap-2 overflow-x-auto bg-theme px-3 py-2.5 sm:gap-4 sm:px-4">
      <audio
        ref={audioRef}
        src={trackAudioUrl(playingTrack.track_id, mediaToken)}
        preload="metadata"
        // The visualizer reads the stream through Web Audio, which needs CORS access.
        crossOrigin="anonymous"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          setDuration(audio.duration || 0)
          if (isPlayingRef.current) {
            audio.play().catch((cause: unknown) => {
              setIsPlaying(false)
              setError(cause instanceof Error ? cause.message : 'Playback failed')
            })
          }
        }}
        onTimeUpdate={(event) => {
          setPosition(event.currentTarget.currentTime)
        }}
        onEnded={() => setIsPlaying(false)}
        onError={(event) => {
          if (event.currentTarget.error?.code === MediaError.MEDIA_ERR_ABORTED) return
          setError('Could not stream this file — check the API and file path.')
        }}
      />

      <button
        type="button"
        onClick={() => setIsPlaying(!isPlaying)}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          'bg-accent text-on-accent transition-colors hover:bg-accent-hover',
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
        <span className="rounded border border-lagoon-200 bg-lagoon-50 px-1.5 py-0.5 text-lagoon-700">
          {bpm === null ? '—' : bpm.toFixed(1)}
        </span>
        <span className="rounded border border-chip-line bg-chip px-1.5 py-0.5 text-chip-ink">
          {keyLabel ?? '—'}
        </span>
        <span className="rounded border border-chip-line bg-chip px-1.5 py-0.5 text-ink">
          {energy === null ? '—' : energy.toFixed(2)}
        </span>
      </span>

      <Visualizer
        audioRef={audioRef}
        isPlaying={isPlaying}
        trackId={playingTrack.track_id}
        className="hidden h-8 w-28 shrink-0 md:block"
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
        <span className="max-w-56 shrink-0 truncate text-xs text-danger">
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
