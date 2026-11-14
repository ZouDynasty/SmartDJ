import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Music4, Pause, Play, X } from 'lucide-react'
import { Artwork } from '@/components/Artwork'
import { MixPathButton } from '@/components/MixPathButton'
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

type DeckIndex = 0 | 1

/** One player slot: just a track and the numbers the transition readout needs. */
interface Slot {
  track: Track
  title: string
  artist: string
  bpm: number | null
  keyLabel: string | null
  /** Normalized 0.0–1.0. */
  energy: number | null
  durationSec: number
}

function toSlot(track: Track): Slot {
  return {
    track,
    title: trackTitle(track),
    artist: trackArtist(track),
    bpm: trackBpm(track),
    keyLabel: trackKey(track),
    energy: normalizedEnergy(track),
    durationSec: trackDuration(track),
  }
}

function keyBadgeClass(keyLabel: string | null): string {
  if (keyLabel?.endsWith('A')) {
    return 'border-lagoon-200 bg-lagoon-50 text-lagoon-800'
  }
  if (keyLabel?.endsWith('B')) {
    return 'border-chip-line bg-chip text-chip-ink'
  }
  return 'border-line bg-raised text-ink-muted'
}

interface SlotCardProps {
  slot: Slot | null
  isPlaying: boolean
  isSelected: boolean
  onSelect: () => void
  onPlay: (track: Track) => void
  onRemove: () => void
  onDropTrack: (track: Track) => void
}

function SlotCard({
  slot,
  isPlaying,
  isSelected,
  onSelect,
  onPlay,
  onRemove,
  onDropTrack,
}: SlotCardProps) {
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
        <Music4 className="size-4 shrink-0 text-ink-muted" />
        <p className="truncate text-sm text-ink-muted">Drop a track here</p>
      </div>
    )
  }

  return (
    <div
      {...dropHandlers}
      data-deck
      onClick={onSelect}
      className={cn(
        'group relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        isOver || isSelected
          ? 'border-accent bg-theme-raised'
          : 'border-theme-line bg-theme hover:bg-theme-raised',
        isSelected && 'shadow-[0_0_0_1px_var(--color-accent)]',
      )}
    >
      <button
        type="button"
        aria-label={isPlaying ? `Pause ${slot.title}` : `Play ${slot.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onPlay(slot.track)
        }}
        className="group/play relative shrink-0"
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
              ? 'bg-black/45 opacity-100'
              : 'bg-black/50 opacity-0 group-hover/play:opacity-100',
          )}
        >
          {isPlaying ? (
            <Pause className="size-5 fill-current text-white" />
          ) : (
            <Play className="size-5 fill-current text-white" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{slot.title}</p>
        <p className="truncate text-xs text-ink-muted">{slot.artist}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
        <span className="rounded border border-lagoon-200 bg-lagoon-50 px-1.5 py-0.5 text-lagoon-700">
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
        <span className="rounded border border-chip-line bg-chip px-1.5 py-0.5 text-ink">
          {slot.energy === null ? '—' : slot.energy.toFixed(2)}
        </span>
        <span className="text-ink-faint">
          {formatDuration(slot.durationSec)}
        </span>
      </div>

      <button
        type="button"
        aria-label={`Remove ${slot.title} from player`}
        title="Remove (Backspace)"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        className="absolute right-1 top-1 rounded p-0.5 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/** Transition readout shown between the two slots. */
function TransitionSummary({
  left,
  right,
}: {
  left: Slot | null
  right: Slot | null
}) {
  if (!left || !right) {
    return (
      <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 px-2">
        <ArrowRight className="size-4 text-ink-faint" />
        <MixPathButton compact />
      </div>
    )
  }

  const bpmDelta =
    left.bpm !== null && right.bpm !== null ? right.bpm - left.bpm : null
  const bpmPercent =
    bpmDelta !== null && left.bpm ? (bpmDelta / left.bpm) * 100 : null
  const energyDelta =
    left.energy !== null && right.energy !== null
      ? (right.energy - left.energy) * 10
      : null
  const relation = camelotRelation(left.keyLabel, right.keyLabel)

  // Beatmatching stays comfortable inside roughly ±6%.
  const bpmSafe = bpmPercent === null || Math.abs(bpmPercent) <= 6

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-3">
      <ArrowRight className="size-4 text-ink-muted" />
      <div className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
        <span className={bpmSafe ? 'text-ink-muted' : 'text-danger'}>
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
                ? 'text-lagoon-700'
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
      <MixPathButton compact />
    </div>
  )
}

export function NowNext() {
  const decks = useSetStore((state) => state.decks)
  const setDeck = useSetStore((state) => state.setDeck)
  const dropOnDeck = useSetStore((state) => state.dropOnDeck)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const isPlaying = useSetStore((state) => state.isPlaying)
  const playTrack = useSetStore((state) => state.playTrack)

  const [selected, setSelected] = useState<DeckIndex | null>(null)

  // Backspace removes the selected track. Clicking anywhere else deselects.
  useEffect(() => {
    if (selected === null) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))
      ) {
        return
      }
      event.preventDefault()
      setDeck(selected, null)
      setSelected(null)
    }
    const handlePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-deck]')) return
      setSelected(null)
    }

    window.addEventListener('keydown', handleKey)
    window.addEventListener('pointerdown', handlePointer)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('pointerdown', handlePointer)
    }
  }, [selected, setDeck])

  const handleRemove = useCallback(
    (index: DeckIndex) => {
      setDeck(index, null)
      setSelected((current) => (current === index ? null : current))
    },
    [setDeck],
  )

  /** A dropped track is selected right away, so Backspace works without a click. */
  const handleDrop = useCallback(
    (index: DeckIndex, track: Track) => {
      dropOnDeck(index, track)
      setSelected(index)
    },
    [dropOnDeck],
  )

  const [left, right] = useMemo(
    () => decks.map((track) => (track ? toSlot(track) : null)),
    [decks],
  )

  const isSlotPlaying = (slot: Slot | null) =>
    isPlaying && slot !== null && playingTrack?.track_id === slot.track.track_id

  return (
    <section
      data-now-next
      className="flex shrink-0 items-stretch gap-2 bg-canvas px-4 py-2.5"
    >
      <SlotCard
        slot={left}
        isPlaying={isSlotPlaying(left)}
        isSelected={selected === 0}
        onSelect={() => setSelected(0)}
        onPlay={playTrack}
        onRemove={() => handleRemove(0)}
        onDropTrack={(track) => handleDrop(0, track)}
      />
      <TransitionSummary left={left} right={right} />
      <SlotCard
        slot={right}
        isPlaying={isSlotPlaying(right)}
        isSelected={selected === 1}
        onSelect={() => setSelected(1)}
        onPlay={playTrack}
        onRemove={() => handleRemove(1)}
        onDropTrack={(track) => handleDrop(1, track)}
      />
    </section>
  )
}
