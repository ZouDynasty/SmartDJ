import { useMemo } from 'react'
import { ArrowRight, Music4, Pause, Play, Radio } from 'lucide-react'
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
    return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
  }
  if (keyLabel?.endsWith('B')) {
    return 'border-amber-400/40 bg-amber-400/10 text-amber-300'
  }
  return 'border-slate-700 bg-slate-800 text-slate-400'
}

interface SlotCardProps {
  slot: Slot | null
  role: 'current' | 'next'
  isPlaying: boolean
  onPlay: (track: Track) => void
  onHover: (instanceId: string | null) => void
}

function SlotCard({ slot, role, isPlaying, onPlay, onHover }: SlotCardProps) {
  const isCurrent = role === 'current'
  const accent = isCurrent ? 'text-cyan-400' : 'text-slate-500'
  const Icon = isCurrent ? Radio : Music4

  if (!slot) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-dashed border-slate-800 px-3 py-2.5">
        <Icon className={cn('size-4 shrink-0', accent)} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {isCurrent ? 'Now playing' : 'Up next'}
          </p>
          <p className="truncate text-sm text-slate-600">
            {isCurrent ? 'Nothing loaded' : 'Set has no next track'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      onMouseEnter={() => onHover(slot.instanceId)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        isCurrent
          ? 'border-cyan-400/50 bg-cyan-400/5'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700',
      )}
    >
      <button
        type="button"
        aria-label={isPlaying ? `Pause ${slot.title}` : `Play ${slot.title}`}
        onClick={() => onPlay(slot.track)}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
          isPlaying
            ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
            : 'border border-slate-700 text-slate-400 hover:border-cyan-400/60 hover:text-cyan-300',
        )}
      >
        {isPlaying ? (
          <Pause className="size-3.5 fill-current" />
        ) : (
          <Play className="size-3.5 fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
          <Icon className={cn('size-3', accent)} />
          <span className={accent}>{isCurrent ? 'Now playing' : 'Up next'}</span>
          {slot.position !== null && (
            <span className="font-mono text-slate-600">
              #{String(slot.position).padStart(2, '0')}
            </span>
          )}
        </p>
        <p className="truncate text-sm font-semibold text-slate-100">
          {slot.title}
        </p>
        <p className="truncate text-xs text-slate-400">{slot.artist}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
        <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-300">
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
        <span className="rounded border border-fuchsia-400/40 bg-fuchsia-400/10 px-1.5 py-0.5 text-fuchsia-300">
          {slot.energy === null ? '—' : slot.energy.toFixed(2)}
        </span>
        <span className="text-slate-500">
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
      <div className="flex shrink-0 items-center px-2 text-slate-700">
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
      <ArrowRight className="size-4 text-slate-600" />
      <div className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
        <span className={bpmSafe ? 'text-slate-400' : 'text-rose-400'}>
          {bpmDelta === null
            ? 'BPM —'
            : `${bpmDelta >= 0 ? '+' : ''}${bpmDelta.toFixed(1)} BPM`}
        </span>
        <span className="text-slate-700">|</span>
        <span
          className={
            relation === null
              ? 'text-slate-500'
              : relation.compatible
                ? 'text-emerald-400'
                : 'text-amber-400'
          }
        >
          {relation?.label ?? 'Key —'}
        </span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-400">
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
  const setHighlight = useSetStore((state) => state.setHighlight)

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
    <section className="flex shrink-0 items-stretch gap-2 border-b border-slate-800 bg-slate-950 px-4 py-2.5">
      <SlotCard
        slot={current}
        role="current"
        isPlaying={isSlotPlaying(current)}
        onPlay={playTrack}
        onHover={(id) => setHighlight(id, 'queue')}
      />
      <TransitionSummary current={current} next={next} />
      <SlotCard
        slot={next}
        role="next"
        isPlaying={isSlotPlaying(next)}
        onPlay={playTrack}
        onHover={(id) => setHighlight(id, 'queue')}
      />
    </section>
  )
}
