import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pause, Play, Shuffle, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import { Artwork } from '@/components/Artwork'
import { Visualizer } from '@/components/Visualizer'
import { cn } from '@/lib/utils'
import { trackArtworkUrl, trackAudioUrl } from '@/lib/api'
import {
  formatDuration,
  normalizedEnergy,
  trackArtist,
  trackBpm,
  trackKey,
  trackTitle,
} from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

/** Back restarts the song once it is further in than this. */
const RESTART_AFTER_SEC = 3

/** Small icon button; blurs after a click so Space stays the library toggle. */
function TransportIcon({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        onClick()
        event.currentTarget.blur()
      }}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-theme hover:text-accent-ink"
    >
      {children}
    </button>
  )
}

/** Icon-only toggle: keeps playing random tracks from the filtered library. */
function ShuffleButton() {
  const shuffleOn = useSetStore((state) => state.shuffleOn)
  const toggleShuffle = useSetStore((state) => state.toggleShuffle)
  const poolEmpty = useSetStore(
    (state) => state.activeQueue.length === 0 && state.shufflePool.length === 0,
  )
  return (
    <button
      type="button"
      aria-label="Shuffle"
      aria-pressed={shuffleOn}
      title="Shuffle: keep playing random tracks from the open set or playlist, or the filtered library if none is open"
      disabled={poolEmpty}
      onClick={(event) => {
        toggleShuffle()
        // Frees Space for the library toggle instead of re-pressing this button.
        event.currentTarget.blur()
      }}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
        shuffleOn
          ? 'bg-accent text-on-accent'
          : 'text-ink-muted hover:bg-theme hover:text-accent-ink',
        poolEmpty && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-ink-muted',
      )}
    >
      <Shuffle className="size-3.5" />
    </button>
  )
}

/**
 * Transport bar streaming the selected track's local file through the API.
 * Seeking relies on the server honouring HTTP Range requests.
 */
export function AudioPlayer() {
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const setIsPlaying = useSetStore((state) => state.setIsPlaying)
  const stopPlayback = useSetStore((state) => state.stopPlayback)
  const handleTrackEnded = useSetStore((state) => state.handleTrackEnded)
  const skipTrack = useSetStore((state) => state.skipTrack)
  const playPrevious = useSetStore((state) => state.playPrevious)
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

  /** Past the first few seconds, Back restarts the song; at the start it goes to the last one played. */
  const handlePrevious = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > RESTART_AFTER_SEC) {
      handleSeek(0)
      return
    }
    if (useSetStore.getState().playHistory.length > 0) playPrevious()
    else handleSeek(0)
  }, [handleSeek, playPrevious])

  // Keyboard media keys (F7/F8/F9 on a Mac) and the system Now Playing widget.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        'play',
        () => {
          const state = useSetStore.getState()
          if (state.playingTrack) state.setIsPlaying(true)
        },
      ],
      ['pause', () => useSetStore.getState().setIsPlaying(false)],
      ['previoustrack', handlePrevious],
      ['nexttrack', skipTrack],
    ]
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        /* this browser does not support the action */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [handlePrevious, skipTrack])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = playingTrack
      ? new MediaMetadata({
          title: trackTitle(playingTrack),
          artist: trackArtist(playingTrack),
          artwork: [
            { src: trackArtworkUrl(playingTrack.track_id, mediaToken) },
          ],
        })
      : null
  }, [playingTrack, mediaToken])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = !playingTrack
      ? 'none'
      : isPlaying
        ? 'playing'
        : 'paused'
  }, [playingTrack, isPlaying])

  if (!playingTrack) {
    return (
      <footer className="flex shrink-0 items-center gap-3 bg-theme px-4 py-2.5">
        <ShuffleButton />
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
        onEnded={handleTrackEnded}
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

      <div className="flex shrink-0 items-center gap-0.5">
        <TransportIcon label="Back" onClick={handlePrevious}>
          <SkipBack className="size-3.5 fill-current" />
        </TransportIcon>
        <TransportIcon label="Skip" onClick={skipTrack}>
          <SkipForward className="size-3.5 fill-current" />
        </TransportIcon>
        <ShuffleButton />
      </div>

      <Visualizer
        audioRef={audioRef}
        isPlaying={isPlaying}
        trackId={playingTrack.track_id}
        className="hidden h-8 w-28 shrink-0 md:block"
      />

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
