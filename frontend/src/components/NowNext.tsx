import { useCallback, useMemo } from 'react'
import { ArrowRight, Music4, Pause, Play, Radio } from 'lucide-react'
import { Artwork } from '@/components/Artwork'
import { useTrackDrop } from '@/lib/dragTrack'
import { cn } from '@/lib/utils'
import {
  camelotRelation,
  formatDuration,
  normalizedEnergy,
  trackArtist,
  trackBpm,
  trackDuration,
  trackKey,
  trackTitle,
} from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'
import type { Track } from '@/types'

/** One side of the panel, sourced from either the queue or the loaded track. */
interface Slot {
  track: Track
  title: string
  artist: string
  bpm: number | null
  keyLabel: string | null
  /** Normalized 0.0–1.0. */
  energy: number | null
  durationSec: number
  /** 1-based queue position, or null when the track is not in the set. */
  position: number | null
  instanceId: string | null
}

function toSlot(
  track: Track,
  position: number | null,
  instanceId: string | null,
): Slot {
  return {
    track,
    title: trackTitle(track),
    artist: trackArtist(track),
    bpm: trackBpm(track),
    keyLabel: trackKey(track),
    energy: normalizedEnergy(track),
    durationSec: trackDuration(track),
    position,
    instanceId,
  }
}

function keyBadgeClass(keyLabel: string | null): string {
  if (keyLabel?.endsWith('A')) {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  if (keyLabel?.endsWith('B')) {
    return 'border-slate-300 bg-slate-100 text-slate-800'
  }
  return 'border-line bg-raised text-ink-muted'
}

interface SlotCardProps {
  slot: Slot | null
  role: 'current' | 'next'
  isPlaying: boolean
  onPlay: (track: Track) => void
  onHover: (instanceId: string | null) => void
  onDropTrack: (track: Track) => void
}

function SlotCard({ slot, role, isPlaying, onPlay, onHover, onDropTrack }: SlotCardProps) {
  const isCurrent = role === 'current'
  const accent = isCurrent ? 'text-accent' : 'text-ink-muted'
  const Icon = isCurrent ? Radio : Music4
  const { isOver, dropHandlers } = useTrackDrop(onDropTrack)

  if (!slot) {
    return (
      <div
        {...dropHandlers}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors',
          isOver
            ? 'border-accent bg-theme-raised'
            : 'border-line bg-panel',
        )}
      >
        <Icon className={cn('size-4 shrink-0', accent)} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            {isCurrent ? 'Now playing' : 'Up next'}
          </p>
          <p className="truncate text-sm text-ink-muted">
            {isCurrent
              ? 'Nothing loaded — drop a track here'
              : 'Drop a track here to play next'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      {...dropHandlers}
      onMouseEnter={() => onHover(slot.instanceId)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        isOver
          ? 'border-accent bg-theme-raised'
          : isCurrent
            ? 'border-theme-line bg-theme'
            : 'border-line bg-panel hover:bg-raised',
      )}
    >
      <button
        type="button"
        aria-label={isPlaying ? `Pause ${slot.title}` : `Play ${slot.title}`}
        onClick={() => onPlay(slot.track)}
        className="group relative shrink-0"
      >
        <Artwork
          trackId={slot.track.track_id}
          title={slot.title}
          className="size-12"
        />
        <span
          className={cn(
            // Scrim stays dark: it sits over album art, not over the theme.
            'absolute inset-0 flex items-center justify-center rounded-md transition-opacity',
            isPlaying
              ? 'bg-ink/45 opacity-100'
              : 'bg-ink/50 opacity-0 group-hover:opacity-100',
          )}
        >
          {isPlaying ? (
            <Pause className="size-5 fill-current text-theme-raised" />
          ) : (
            <Play className="size-5 fill-current text-white" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
          <Icon className={cn('size-3', accent)} />
          <span className={accent}>{isCurrent ? 'Now playing' : 'Up next'}</span>
          {slot.position !== null && (
            <span className="font-mono text-ink-faint">
              #{String(slot.position).padStart(2, '0')}
            </span>
          )}
        </p>
        <p className="truncate text-sm font-semibold text-ink">
          {slot.title}
        </p>
        <p className="truncate text-xs text-ink-muted">{slot.artist}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
          {slot.bpm === null ? '—' : slot.bpm.toFixed(1)}
        </span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5',
            keyBadgeClass(slot.keyLabel),
          )}
        >
          {slot.keyLabel ?? '—'}
        </span>
        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-ink">
          {slot.energy === null ? '—' : slot.energy.toFixed(2)}
        </span>
        <span className="text-ink-faint">
          {formatDuration(slot.durationSec)}
        </span>
      </div>
    </div>
  )
}

/** Transition readout shown between the two slots. */
function TransitionSummary({
  current,
  next,
}: {
  current: Slot | null
  next: Slot | null
}) {
  if (!current || !next) {
    return (
      <div className="flex shrink-0 items-center px-2 text-ink-faint">
        <ArrowRight className="size-4" />
      </div>
    )
  }

  const bpmDelta =
    current.bpm !== null && next.bpm !== null ? next.bpm - current.bpm : null
  const bpmPercent =
    bpmDelta !== null && current.bpm ? (bpmDelta / current.bpm) * 100 : null
  const energyDelta =
    current.energy !== null && next.energy !== null
      ? (next.energy - current.energy) * 10
      : null
  const relation = camelotRelation(current.keyLabel, next.keyLabel)

  // Beatmatching stays comfortable inside roughly ±6%.
  const bpmSafe = bpmPercent === null || Math.abs(bpmPercent) <= 6

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-3">
      <ArrowRight className="size-4 text-ink-muted" />
      <div className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
        <span className={bpmSafe ? 'text-ink-muted' : 'text-rose-600'}>
          {bpmDelta === null
            ? 'BPM —'
            : `${bpmDelta >= 0 ? '+' : ''}${bpmDelta.toFixed(1)} BPM`}
        </span>
        <span className="text-ink-faint">|</span>
        <span
          className={
            relation === null
              ? 'text-ink-muted'
              : relation.compatible
                ? 'text-blue-700'
                : 'text-ink'
          }
        >
          {relation?.label ?? 'Key —'}
        </span>
        <span className="text-ink-faint">|</span>
        <span className="text-ink-muted">
          {energyDelta === null
            ? 'Energy —'
            : `${energyDelta >= 0 ? '+' : ''}${energyDelta.toFixed(1)} energy`}
        </span>
      </div>
    </div>
  )
}

export function NowNext() {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const playTrack = useSetStore((state) => state.playTrack)
  const playNow = useSetStore((state) => state.playNow)
  const queueNext = useSetStore((state) => state.queueNext)
  const setHighlight = useSetStore((state) => state.setHighlight)

  const handleDropCurrent = useCallback(
    (track: Track) => {
      playNow(track)
    },
    [playNow],
  )

  const handleDropNext = useCallback(
    (track: Track) => {
      queueNext(track)
    },
    [queueNext],
  )

  const { current, next } = useMemo(() => {
    const queueIndex = playingTrack
      ? activeQueue.findIndex(
          (item) => item.track.track_id === playingTrack.track_id,
        )
      : -1

    // Playing from the queue: next is whatever follows it.
    if (queueIndex >= 0) {
      const following = activeQueue[queueIndex + 1]
      return {
        current: toSlot(
          activeQueue[queueIndex].track,
          queueIndex + 1,
          activeQueue[queueIndex].instance_id,
        ),
        next: following
          ? toSlot(following.track, queueIndex + 2, following.instance_id)
          : null,
      }
    }

    // Previewing from the catalog, or nothing loaded: the set starts at the top.
    const head = activeQueue[0]
    return {
      current: playingTrack ? toSlot(playingTrack, null, null) : null,
      next: head ? toSlot(head.track, 1, head.instance_id) : null,
    }
  }, [activeQueue, playingTrack])

  const isSlotPlaying = (slot: Slot | null) =>
    isPlaying && slot !== null && playingTrack?.track_id === slot.track.track_id

  return (
    <section
      data-now-next
      className="flex shrink-0 items-stretch gap-2 bg-canvas px-4 py-2.5"
    >
      <SlotCard
        slot={current}
        role="current"
        isPlaying={isSlotPlaying(current)}
        onPlay={playTrack}
        onHover={(id) => setHighlight(id, 'queue')}
        onDropTrack={handleDropCurrent}
      />
      <TransitionSummary current={current} next={next} />
      <SlotCard
        slot={next}
        role="next"
        isPlaying={isSlotPlaying(next)}
        onPlay={playTrack}
        onHover={(id) => setHighlight(id, 'queue')}
        onDropTrack={handleDropNext}
      />
    </section>
  )
}
