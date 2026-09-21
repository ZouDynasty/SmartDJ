import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { trackArtist, trackTitle } from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'
import type { Track } from '@/types'

let dragGhost: HTMLDivElement | null = null

function removeDragGhost(): void {
  dragGhost?.remove()
  dragGhost = null
}

/** Compact dashed box used as the HTML5 drag image. */
function attachTrackDragImage(dataTransfer: DataTransfer, track: Track): void {
  removeDragGhost()

  const ghost = document.createElement('div')
  ghost.className = 'track-drag-ghost'
  ghost.setAttribute('aria-hidden', 'true')

  const title = document.createElement('div')
  title.className = 'track-drag-ghost-title'
  title.textContent = trackTitle(track)

  const artist = document.createElement('div')
  artist.className = 'track-drag-ghost-artist'
  artist.textContent = trackArtist(track)

  ghost.append(title, artist)
  document.body.append(ghost)
  dragGhost = ghost
  dataTransfer.setDragImage(ghost, 16, 16)
}

/** Custom MIME so catalog drops are distinct from text selection drags. */
export const TRACK_DRAG_MIME = 'application/x-smartdj-track'

/** `dataTransfer.types` is unreliable for custom MIME during dragover in Safari. */
let catalogDragActive = false

export function beginTrackDrag(): void {
  catalogDragActive = true
}

export function endTrackDrag(): void {
  catalogDragActive = false
  removeDragGhost()
}

export function isTrackDrag(): boolean {
  return catalogDragActive
}

export function setTrackDragData(
  dataTransfer: DataTransfer,
  track: Track,
): void {
  const id = String(track.track_id)
  dataTransfer.setData(TRACK_DRAG_MIME, id)
  dataTransfer.setData('text/plain', id)
  dataTransfer.effectAllowed = 'copy'
  attachTrackDragImage(dataTransfer, track)
  beginTrackDrag()
}

export function getDraggedTrackId(dataTransfer: DataTransfer): number | null {
  const raw =
    dataTransfer.getData(TRACK_DRAG_MIME) || dataTransfer.getData('text/plain')
  if (!raw) return null
  const trackId = Number(raw)
  return Number.isFinite(trackId) ? trackId : null
}

/** Drop-zone handlers for Now Playing / Up Next. */
export function useTrackDrop(onDropTrack: (track: Track) => void) {
  const [isOver, setIsOver] = useState(false)
  const depthRef = useRef(0)

  const reset = useCallback(() => {
    depthRef.current = 0
    setIsOver(false)
  }, [])

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isTrackDrag()) return
    event.preventDefault()
    depthRef.current += 1
    setIsOver(true)
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isTrackDrag()) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback(() => {
    if (!isTrackDrag()) return
    depthRef.current -= 1
    if (depthRef.current <= 0) reset()
  }, [reset])

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      reset()
      const trackId = getDraggedTrackId(event.dataTransfer)
      if (trackId === null) return
      const track = useSetStore
        .getState()
        .catalog.find((entry) => entry.track_id === trackId)
      if (track) onDropTrack(track)
    },
    [onDropTrack, reset],
  )

  return {
    isOver,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
