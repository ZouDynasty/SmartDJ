import { useEffect } from 'react'
import { Headphones, TriangleAlert } from 'lucide-react'
import { AudioPlayer } from '@/components/AudioPlayer'
import { NowNext } from '@/components/NowNext'
import { SetBuilder } from '@/components/SetBuilder'
import { SetGraph } from '@/components/SetGraph'
import { TrackLibrary } from '@/components/TrackLibrary'
import { getTracks } from '@/lib/api'
import { formatDuration, totalSetDuration } from '@/lib/setMath'
import { useSetStore } from '@/store/useSetStore'

function App() {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const catalog = useSetStore((state) => state.catalog)
  const catalogStatus = useSetStore((state) => state.catalogStatus)
  const catalogError = useSetStore((state) => state.catalogError)
  const setCatalog = useSetStore((state) => state.setCatalog)
  const setCatalogStatus = useSetStore((state) => state.setCatalogStatus)
  const setCatalogError = useSetStore((state) => state.setCatalogError)

  useEffect(() => {
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
  }, [setCatalog, setCatalogError, setCatalogStatus])

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Headphones className="size-4 text-cyan-400" />
        <h1 className="text-sm font-semibold tracking-tight text-slate-100">
          SmartDJ
          <span className="ml-2 font-normal text-slate-500">Set Builder</span>
        </h1>
        <span className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-0.5 font-mono text-xs text-slate-400">
          {activeQueue.length} in set ·{' '}
          {formatDuration(totalSetDuration(activeQueue))}
        </span>
        <span className="font-mono text-xs text-slate-500">
          {catalogStatus === 'ready'
            ? `${catalog.length} tracks in library`
            : 'connecting to library…'}
        </span>
        {catalogStatus === 'error' && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-rose-400">
            <TriangleAlert className="size-3.5" />
            {catalogError} — start the API with{' '}
            <code className="text-rose-300">
              python -m uvicorn api.main:app --port 8000
            </code>
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <SetGraph />
          <NowNext />
          <TrackLibrary />
        </div>
        <SetBuilder />
      </div>

      <AudioPlayer />
    </div>
  )
}

export default App
