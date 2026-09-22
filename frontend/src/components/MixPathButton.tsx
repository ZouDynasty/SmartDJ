import { useCallback, useMemo, useState } from 'react'
import { Route } from 'lucide-react'
import { getMixPath } from '@/lib/api'
import { cn } from '@/lib/utils'
import { resolveNowNext, trackTitle } from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

export function MixPathButton({
  stretch = false,
  compact = false,
}: {
  stretch?: boolean
  compact?: boolean
}) {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const playingTrack = useSetStore((state) => state.playingTrack)
  const insertMixPath = useSetStore((state) => state.insertMixPath)

  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; hops: number; start: string; goal: string }
    | { kind: 'empty' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const endpoints = useMemo(() => {
    const pair = resolveNowNext(activeQueue, playingTrack)
    if (
      pair.current &&
      pair.next &&
      pair.current.track_id !== pair.next.track_id
    ) {
      return { start: pair.current, goal: pair.next }
    }
    return null
  }, [activeQueue, playingTrack])

  const handleClick = useCallback(() => {
    if (!endpoints) return

    const { start, goal } = endpoints
    setStatus({ kind: 'loading' })

    getMixPath(start.track_id, goal.track_id)
      .then((path) => {
        if (!path.found || path.tracks.length === 0) {
          setStatus({ kind: 'empty' })
          return
        }
        insertMixPath(path.tracks)
        setStatus({
          kind: 'ready',
          hops: path.hops,
          start: trackTitle(path.tracks[0]),
          goal: trackTitle(path.tracks[path.tracks.length - 1]),
        })
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to find a mixing path.',
        })
      })
  }, [endpoints, insertMixPath])

  const disabled = endpoints === null || status.kind === 'loading'
  const tooltip = endpoints
    ? `Find the shortest mixable route from ${trackTitle(endpoints.start)} to ${trackTitle(endpoints.goal)}`
    : 'Load a track in Now Playing and another in Up Next'

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1',
        stretch ? 'items-stretch' : 'items-center',
        !stretch && !compact && 'items-end',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        title={tooltip}
        onClick={handleClick}
        className={cn(
          'flex items-center justify-center gap-2 rounded-lg border-2 font-semibold tracking-tight transition-colors',
          compact
            ? 'px-2.5 py-1 text-xs'
            : 'px-4 py-2 text-sm',
          stretch ? 'w-full' : 'shrink-0',
          status.kind === 'loading'
            ? 'border-accent bg-accent text-white shadow-sm shadow-accent/30'
            : 'border-accent bg-theme-raised text-accent hover:bg-theme',
          disabled &&
            status.kind !== 'loading' &&
            'cursor-not-allowed border-line bg-raised text-ink-faint hover:bg-raised',
        )}
      >
        <Route className={compact ? 'size-3.5' : 'size-4'} />
        {status.kind === 'loading'
          ? 'Finding path…'
          : compact
            ? 'Find path'
            : 'Shortest mixing path'}
      </button>
      {status.kind === 'ready' && (
        <p
          className={cn(
            'max-w-72 truncate text-[11px] text-ink-muted',
            compact || stretch ? 'text-center' : 'text-right',
          )}
        >
          {status.hops}-hop path · {status.start} → {status.goal}
        </p>
      )}
      {status.kind === 'empty' && (
        <p className="max-w-72 text-center text-[11px] text-rose-600">
          No mixable path within 10 hops.
        </p>
      )}
      {status.kind === 'error' && (
        <p className="max-w-72 text-center text-[11px] text-rose-600">
          {status.message}
        </p>
      )}
    </div>
  )
}
