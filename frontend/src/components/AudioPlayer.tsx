import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume2, X } from 'lucide-react'
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

  const audioRef = useRef<HTMLAudioElement>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)

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

  if (!playingTrack) return null

  const effectiveDuration = duration || playingTrack.duration || 0
  const energy = normalizedEnergy(playingTrack)
  const bpm = trackBpm(playingTrack)

  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-900/80 px-4 py-2.5">
      <audio
        ref={audioRef}
        src={trackAudioUrl(playingTrack.track_id)}
        preload="metadata"
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
        onError={() =>
          setError('Could not stream this file — check the API and file path.')
        }
      />

      <button
        type="button"
        onClick={() => setIsPlaying(!isPlaying)}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          'bg-cyan-400 text-slate-950 transition-colors hover:bg-cyan-300',
        )}
      >
        {isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
      </button>

      <div className="min-w-0 w-64 shrink-0">
        <p className="truncate text-sm font-semibold text-slate-100">
          {trackTitle(playingTrack)}
        </p>
        <p className="truncate text-xs text-slate-400">
          {trackArtist(playingTrack)}
        </p>
      </div>

      <span className="hidden shrink-0 items-center gap-1.5 font-mono text-xs md:flex">
        <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-300">
          {bpm === null ? '—' : bpm.toFixed(1)}
        </span>
        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-amber-300">
          {trackKey(playingTrack) ?? '—'}
        </span>
        <span className="rounded border border-fuchsia-400/40 bg-fuchsia-400/10 px-1.5 py-0.5 text-fuchsia-300">
          {energy === null ? '—' : energy.toFixed(2)}
        </span>
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-slate-400">
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
          className="h-1 min-w-0 flex-1 cursor-pointer accent-cyan-400"
        />
        <span className="shrink-0 font-mono text-xs text-slate-500">
          {formatDuration(effectiveDuration)}
        </span>
      </div>

      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        <Volume2 className="size-3.5 text-slate-500" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1 w-20 cursor-pointer accent-cyan-400"
        />
      </div>

      {error && (
        <span className="max-w-56 shrink-0 truncate text-xs text-rose-400">
          {error}
        </span>
      )}

      <button
        type="button"
        onClick={stopPlayback}
        aria-label="Close player"
        className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
      >
        <X className="size-4" />
      </button>
    </footer>
  )
}
