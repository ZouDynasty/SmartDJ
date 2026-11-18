import { useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ListPlus,
  ListStart,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { useTrackDrop } from '@/lib/dragTrack'
import { trackArtist, trackTitle } from '@/lib/setMath'
import { cn } from '@/lib/utils'
import { useSetStore } from '@/store/useSetStore'
import type { UserPlaylist } from '@/types'

interface PlaylistRowProps {
  playlist: UserPlaylist
  expanded: boolean
  confirmingDelete: boolean
  onToggle: () => void
  onAskDelete: (id: string | null) => void
}

/** One playlist: a drop target for library tracks, expandable to its tracks. */
function PlaylistRow({
  playlist,
  expanded,
  confirmingDelete,
  onToggle,
  onAskDelete,
}: PlaylistRowProps) {
  const catalog = useSetStore((state) => state.catalog)
  const renamePlaylist = useSetStore((state) => state.renamePlaylist)
  const addTracksToPlaylist = useSetStore((state) => state.addTracksToPlaylist)
  const removeTrackFromPlaylist = useSetStore(
    (state) => state.removeTrackFromPlaylist,
  )
  const deletePlaylist = useSetStore((state) => state.deletePlaylist)
  const loadPlaylistIntoQueue = useSetStore(
    (state) => state.loadPlaylistIntoQueue,
  )
  const playTrack = useSetStore((state) => state.playTrack)

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(playlist.name)
  /** Escape leaves the field, and the blur that follows must not save. */
  const renameCancelled = useRef(false)

  const { isOver, dropHandlers } = useTrackDrop((track) => {
    addTracksToPlaylist(playlist.id, [track.track_id])
  })

  const catalogById = useMemo(
    () => new Map(catalog.map((track) => [track.track_id, track])),
    [catalog],
  )

  const commitRename = () => {
    if (!renameCancelled.current) renamePlaylist(playlist.id, draftName)
    setRenaming(false)
  }

  if (confirmingDelete) {
    return (
      <li className="border-b border-theme-line/60 bg-danger-soft last:border-b-0">
        <div className="flex flex-col gap-1.5 px-2 py-1.5">
          <p className="text-xs font-medium text-ink">Delete {playlist.name}?</p>
          <p className="text-[10px] text-ink-muted">
            Are you sure? This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onAskDelete(null)}
              className="rounded-md border border-theme-line px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                deletePlaylist(playlist.id)
                onAskDelete(null)
              }}
              className="rounded-md border border-rose-400 bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-600"
            >
              Delete
            </button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li
      {...dropHandlers}
      data-playlist-drop
      className={cn(
        'border-b border-theme-line/60 last:border-b-0',
        isOver && 'bg-theme-raised shadow-[inset_0_0_0_2px_var(--color-accent)]',
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} tracks in ${playlist.name}`}
          className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>

        {renaming ? (
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') {
                renameCancelled.current = true
                setDraftName(playlist.name)
                setRenaming(false)
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-accent bg-theme px-1.5 py-0.5 text-xs text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="min-w-0 flex-1 py-1.5 text-left"
          >
            <p className="truncate text-xs font-medium text-ink">
              {playlist.name}
            </p>
            <p className="font-mono text-[10px] text-ink-faint">
              {playlist.track_ids.length} tracks
            </p>
          </button>
        )}

        <button
          type="button"
          title="Replace the queue with this playlist"
          aria-label={`Load ${playlist.name} into the queue`}
          disabled={playlist.track_ids.length === 0}
          onClick={() => loadPlaylistIntoQueue(playlist.id, 'replace')}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ListStart className="size-3" />
        </button>
        <button
          type="button"
          title="Add this playlist after the queue"
          aria-label={`Add ${playlist.name} to the end of the queue`}
          disabled={playlist.track_ids.length === 0}
          onClick={() => loadPlaylistIntoQueue(playlist.id, 'append')}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ListPlus className="size-3" />
        </button>
        <button
          type="button"
          title="Rename"
          aria-label={`Rename ${playlist.name}`}
          onClick={() => {
            renameCancelled.current = false
            setDraftName(playlist.name)
            setRenaming(true)
          }}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${playlist.name}`}
          onClick={() => onAskDelete(playlist.id)}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
        >
          <X className="size-3" />
        </button>
      </div>

      {expanded && (
        <ol className="border-t border-theme-line/60 bg-theme-raised/50">
          {playlist.track_ids.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-muted">
              Empty. Drag tracks from the library onto this playlist.
            </li>
          ) : (
            playlist.track_ids.map((trackId) => {
              const track = catalogById.get(trackId)
              return (
                <li
                  key={trackId}
                  className="group flex items-center gap-1 px-2 py-1"
                >
                  <button
                    type="button"
                    disabled={!track}
                    onDoubleClick={() => track && playTrack(track)}
                    title={track ? 'Double-click to play' : undefined}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <p
                      className={cn(
                        'truncate text-[11px] leading-tight',
                        track ? 'text-ink' : 'italic text-ink-faint',
                      )}
                    >
                      {track ? trackTitle(track) : `Missing track #${trackId}`}
                    </p>
                    {track && (
                      <p className="truncate text-[10px] leading-tight text-ink-muted">
                        {trackArtist(track)}
                      </p>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${track ? trackTitle(track) : `track ${trackId}`} from ${playlist.name}`}
                    onClick={() =>
                      removeTrackFromPlaylist(playlist.id, trackId)
                    }
                    className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              )
            })
          )}
        </ol>
      )}
    </li>
  )
}

/** The Playlists tab of the Saved panel. */
export function PlaylistsPanel() {
  const playlists = useSetStore((state) => state.playlists)
  const playlistsError = useSetStore((state) => state.playlistsError)
  const activeQueue = useSetStore((state) => state.activeQueue)
  const createPlaylist = useSetStore((state) => state.createPlaylist)

  const [name, setName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const canCreate = name.trim().length > 0
  const queueIds = activeQueue.map((item) => item.track.track_id)

  const handleCreate = (trackIds: number[]) => {
    if (!canCreate) return
    createPlaylist(name, trackIds)
    setName('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          handleCreate([])
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New playlist…"
          className={cn(
            'min-w-0 flex-1 rounded-md border border-theme-line bg-theme px-2 py-1',
            'text-xs text-ink placeholder:text-ink-faint',
            'outline-none focus:border-accent',
          )}
        />
        <button
          type="submit"
          disabled={!canCreate}
          title="Create an empty playlist"
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold',
            canCreate
              ? 'border-accent bg-accent text-on-accent hover:bg-accent-hover'
              : 'cursor-not-allowed border-theme-line text-ink-faint',
          )}
        >
          <Plus className="size-3" />
          Create
        </button>
        <button
          type="button"
          disabled={!canCreate || queueIds.length === 0}
          onClick={() => handleCreate(queueIds)}
          title="Create a playlist from the tracks in the queue"
          className={cn(
            'shrink-0 rounded-md border px-2 py-1 text-xs',
            canCreate && queueIds.length > 0
              ? 'border-theme-line text-ink-muted hover:border-ink hover:text-ink'
              : 'cursor-not-allowed border-theme-line text-ink-faint',
          )}
        >
          From queue
        </button>
      </form>

      {playlistsError && <p className="text-xs text-danger">{playlistsError}</p>}

      <ul className="max-h-56 overflow-y-auto rounded-md border border-theme-line bg-theme">
        {playlists.length === 0 ? (
          <li className="px-2 py-2 text-xs text-ink-muted">
            No playlists yet.
          </li>
        ) : (
          playlists.map((playlist) => (
            <PlaylistRow
              key={playlist.id}
              playlist={playlist}
              expanded={expandedId === playlist.id}
              confirmingDelete={pendingDeleteId === playlist.id}
              onToggle={() =>
                setExpandedId((current) =>
                  current === playlist.id ? null : playlist.id,
                )
              }
              onAskDelete={setPendingDeleteId}
            />
          ))
        )}
      </ul>
    </div>
  )
}
