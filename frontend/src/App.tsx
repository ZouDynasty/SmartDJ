import { useCallback, useEffect, useRef, useState } from 'react'
import { StudioHeader } from '@/components/StudioHeader'
import { AudioPlayer } from '@/components/AudioPlayer'
import { LibrarySetup } from '@/components/LibrarySetup'
import { MixingPreferences } from '@/components/MixingPreferences'
import { NowNext } from '@/components/NowNext'
import { ResizeHandle } from '@/components/ResizeHandle'
import { SetBuilder } from '@/components/SetBuilder'
import { SetGraph } from '@/components/SetGraph'
import { TrackLibrary } from '@/components/TrackLibrary'
import { getAuthStatus, getTracks } from '@/lib/api'
import {
  clampGraphHeight,
  clampSidebarWidth,
  loadPanelLayout,
  persistPanelLayout,
} from '@/lib/panelLayout'
import { fetchPlaylists } from '@/lib/playlists'
import { fetchSavedSets, importLegacySavedSets } from '@/lib/savedSets'
import { formatDuration, totalSetDuration } from '@/lib/setMath'
import { supabase } from '@/lib/supabase'
import { useSetStore } from '@/store/useSetStore'

function App() {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const savedSets = useSetStore((state) => state.savedSets)
  const loadedSetId = useSetStore((state) => state.loadedSetId)
  const catalog = useSetStore((state) => state.catalog)
  const catalogStatus = useSetStore((state) => state.catalogStatus)
  const setCatalog = useSetStore((state) => state.setCatalog)
  const setCatalogStatus = useSetStore((state) => state.setCatalogStatus)
  const setCatalogError = useSetStore((state) => state.setCatalogError)
  const setAuth = useSetStore((state) => state.setAuth)
  const clearLibrary = useSetStore((state) => state.clearLibrary)
  const setSavedSets = useSetStore((state) => state.setSavedSets)
  const setSavedSetsError = useSetStore((state) => state.setSavedSetsError)
  const setPlaylists = useSetStore((state) => state.setPlaylists)
  const setPlaylistsError = useSetStore((state) => state.setPlaylistsError)
  const signedInUserId = useSetStore((state) => state.auth?.user?.id ?? null)
  const libraryVersion = useSetStore((state) => state.libraryVersion)
  /** Undefined until Supabase reports the stored session (or its absence). */
  const [sessionUserId, setSessionUserId] = useState<string | null>()

  const columnRef = useRef<HTMLDivElement>(null)
  const dragOrigin = useRef(loadPanelLayout())
  const [sidebarWidth, setSidebarWidth] = useState(
    () => loadPanelLayout().sidebarWidth,
  )
  const [graphHeight, setGraphHeight] = useState(
    () => loadPanelLayout().graphHeight,
  )
  const [graphCollapsed, setGraphCollapsed] = useState(false)
  const [queueCollapsed, setQueueCollapsed] = useState(false)
  // Space toggles the trajectory panel so the library grows upward and back.
  // Ignored while typing or on a focused control, where Space already acts.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, button, a, [role]'))
      ) {
        return
      }
      event.preventDefault()
      setGraphCollapsed((value) => !value)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const sidebarWidthRef = useRef(sidebarWidth)
  const graphHeightRef = useRef(graphHeight)
  sidebarWidthRef.current = sidebarWidth
  graphHeightRef.current = graphHeight

  // Fires once with the stored session, then on every sign-in, sign-out and
  // hourly token refresh. Only the user id is kept, so a refresh does not
  // re-fetch /auth/me and swap the media token under a playing track.
  // Supabase calls must not be awaited inside this callback.
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (sessionUserId === undefined) return
    if (sessionUserId === null) clearLibrary()
    const controller = new AbortController()
    getAuthStatus(controller.signal)
      .then(setAuth)
      .catch(() => {
        if (controller.signal.aborted) return
        setCatalogStatus('error')
        setCatalogError('Cannot reach the API.')
      })
    return () => controller.abort()
  }, [sessionUserId, clearLibrary, setAuth, setCatalogError, setCatalogStatus])

  useEffect(() => {
    if (signedInUserId === null) return
    let cancelled = false
    importLegacySavedSets()
      .then(fetchSavedSets)
      .then((sets) => {
        if (!cancelled) setSavedSets(sets)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSavedSetsError(
          error instanceof Error ? error.message : 'Failed to load saved sets.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [signedInUserId, setSavedSets, setSavedSetsError])

  useEffect(() => {
    if (signedInUserId === null) return
    let cancelled = false
    fetchPlaylists()
      .then((playlists) => {
        if (!cancelled) setPlaylists(playlists)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPlaylistsError(
          error instanceof Error ? error.message : 'Failed to load playlists.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [signedInUserId, setPlaylists, setPlaylistsError])

  useEffect(() => {
    if (signedInUserId === null) return
    const controller = new AbortController()
    setCatalogStatus('loading')
    setCatalogError(null)

    getTracks(controller.signal)
      .then((tracks) => {
        setCatalog(tracks)
        setCatalogStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setCatalogStatus('error')
        setCatalogError(
          error instanceof Error ? error.message : 'Failed to load the library.',
        )
      })

    return () => controller.abort()
  }, [signedInUserId, libraryVersion, setCatalog, setCatalogError, setCatalogStatus])

  useEffect(() => {
    const column = columnRef.current
    if (!column) return

    const apply = () => {
      setGraphHeight((height) => clampGraphHeight(height, column))
      setSidebarWidth((width) => clampSidebarWidth(width))
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(column)
    window.addEventListener('resize', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [])

  const persistSizes = useCallback(() => {
    persistPanelLayout({
      sidebarWidth: sidebarWidthRef.current,
      graphHeight: graphHeightRef.current,
    })
  }, [])

  return (
    <div className="studio-shell font-sans text-ink">
      <StudioHeader name={savedSets.find((entry) => entry.id === loadedSetId)?.name ?? 'Untitled set'}
        count={activeQueue.length} duration={formatDuration(totalSetDuration(activeQueue))}
        connected={catalogStatus === 'ready'} library={catalogStatus === 'ready' ? `${catalog.length} library tracks` : catalogStatus === 'loading' ? 'Connecting…' : 'Library offline'} />
      <main className="studio-workspace">
        <div
          ref={columnRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <SetGraph
            height={graphHeight}
            collapsed={graphCollapsed}
            onToggle={() => setGraphCollapsed((value) => !value)}
          />
          {graphCollapsed ? (
            <div className="h-px shrink-0 bg-seam" />
          ) : (
          <ResizeHandle
            axis="y"
            label="Resize set trajectory"
            onDragStart={() => {
              dragOrigin.current.graphHeight = graphHeight
            }}
            onDrag={(delta) => {
              setGraphHeight(
                clampGraphHeight(
                  dragOrigin.current.graphHeight + delta,
                  columnRef.current,
                ),
              )
            }}
            onDragEnd={persistSizes}
          />
          )}
          <NowNext />
          {graphCollapsed ? (
            <div className="h-px shrink-0 bg-seam" />
          ) : (
          <ResizeHandle
            axis="y"
            label="Resize DJ catalog"
            onDragStart={() => {
              dragOrigin.current.graphHeight = graphHeight
            }}
            onDrag={(delta) => {
              setGraphHeight(
                clampGraphHeight(
                  dragOrigin.current.graphHeight + delta,
                  columnRef.current,
                ),
              )
            }}
            onDragEnd={persistSizes}
          />
          )}
          <TrackLibrary />
        </div>
        {queueCollapsed ? (
          <div className="w-px shrink-0 bg-seam" />
        ) : (
        <ResizeHandle
          axis="x"
          invert
          label="Resize set queue"
          onDragStart={() => {
            dragOrigin.current.sidebarWidth = sidebarWidth
          }}
          onDrag={(delta) => {
            setSidebarWidth(clampSidebarWidth(dragOrigin.current.sidebarWidth + delta))
          }}
          onDragEnd={persistSizes}
        />
        )}
        <SetBuilder
          width={sidebarWidth}
          collapsed={queueCollapsed}
          onToggle={() => setQueueCollapsed((value) => !value)}
        />
      </main>

      <AudioPlayer />
      <LibrarySetup />
      <MixingPreferences />
    </div>
  )
}

export default App
