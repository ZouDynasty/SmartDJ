import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode2, FolderOpen, Library, LoaderCircle } from 'lucide-react'
import {
  browseForPath,
  getLibrarySetup,
  markLibrarySetupSeen,
  startLibrarySetup,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSetStore } from '@/store/useSetStore'
import type { LibraryImportJob, LibrarySetupStatus } from '@/types'

const POLL_MS = 1000

const inputClass =
  'min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-accent'
const secondaryButtonClass =
  'flex shrink-0 items-center gap-1.5 rounded-lg border border-theme-line bg-theme-raised px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-theme disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass =
  'rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

function phaseLabel(job: LibraryImportJob): string {
  return job.phase === 'analysis'
    ? 'Analyzing audio for energy and missing BPM, key and genre'
    : 'Importing tracks and playlists'
}

function ImportProgress({ job }: { job: LibraryImportJob }) {
  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <LoaderCircle className="size-3.5 animate-spin text-accent-ink" />
          {phaseLabel(job)}
        </span>
        <span className="font-mono">
          {job.total > 0 ? `${job.done} / ${job.total}` : 'reading XML…'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function PathField({
  label,
  hint,
  value,
  placeholder,
  icon: Icon,
  disabled,
  onChange,
  onBrowse,
}: {
  label: string
  hint: string
  value: string
  placeholder: string
  icon: typeof FolderOpen
  disabled: boolean
  onChange: (value: string) => void
  onBrowse: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink">{label}</span>
      <span className="text-[11px] leading-snug text-ink-muted">{hint}</span>
      <span className="mt-0.5 flex gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          className={inputClass}
        />
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled}
          className={secondaryButtonClass}
        >
          <Icon className="size-3.5" />
          Browse…
        </button>
      </span>
    </label>
  )
}

/**
 * Asks for the Rekordbox XML export and the music folder the first time this
 * machine signs in, then shows the import while the API builds the library.
 */
export function LibrarySetup() {
  const signedInUserId = useSetStore((state) => state.auth?.user?.id ?? null)
  const open = useSetStore((state) => state.setupOpen)
  const setOpen = useSetStore((state) => state.setSetupOpen)
  const bumpLibraryVersion = useSetStore((state) => state.bumpLibraryVersion)

  const [status, setStatus] = useState<LibrarySetupStatus | null>(null)
  const [xmlPath, setXmlPath] = useState('')
  const [musicRoot, setMusicRoot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const previousJob = useRef<LibraryImportJob | null>(null)

  const applyStatus = useCallback((next: LibrarySetupStatus) => {
    setStatus(next)
    setXmlPath((current) => current || next.rekordbox_xml || '')
    setMusicRoot((current) => current || next.music_root || '')
  }, [])

  useEffect(() => {
    if (signedInUserId === null) {
      setOpen(false)
      return
    }
    const controller = new AbortController()
    getLibrarySetup(controller.signal)
      .then((next) => {
        applyStatus(next)
        // Auto-open only the first time; afterwards it is reachable from the
        // account menu, and a running import shows the small progress card.
        if (!next.seen) {
          setOpen(true)
          markLibrarySetupSeen().catch(() => {})
        }
      })
      .catch(() => {
        /* App already reports an unreachable API. */
      })
    return () => controller.abort()
  }, [signedInUserId, applyStatus, setOpen])

  const running = status?.job.state === 'running'

  useEffect(() => {
    if (!running) return
    const handle = window.setInterval(() => {
      getLibrarySetup().then(applyStatus).catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(handle)
  }, [running, applyStatus])

  // Reload the catalog once tracks land, and again when analysis adds energy.
  useEffect(() => {
    const job = status?.job ?? null
    const before = previousJob.current
    previousJob.current = job
    if (!job || !before || before.state !== 'running') return
    const tracksFinished = before.phase === 'tracks' && job.phase !== 'tracks'
    const importFinished = job.state !== 'running'
    if (tracksFinished || importFinished) bumpLibraryVersion()
  }, [status, bumpLibraryVersion])

  const job = status?.job
  const importingTracks = running && job?.phase === 'tracks'
  const canClose =
    !submitting &&
    !importingTracks &&
    (status?.configured || status?.database_exists || running)

  useEffect(() => {
    if (!open || !canClose) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, canClose, setOpen])

  if (signedInUserId === null || status === null || !job) return null

  if (!open) {
    if (!running) return null
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 right-4 z-40 w-72 rounded-lg border border-theme-line bg-float p-3 text-left shadow-lg"
      >
        <ImportProgress job={job} />
      </button>
    )
  }

  const browse = (kind: 'xml' | 'folder') => {
    setBrowsing(true)
    setError(null)
    browseForPath(kind)
      .then((path) => {
        if (path === null) return
        if (kind === 'xml') setXmlPath(path)
        else setMusicRoot(path)
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not open the picker.'),
      )
      .finally(() => setBrowsing(false))
  }

  const submit = () => {
    setSubmitting(true)
    setError(null)
    startLibrarySetup({ rekordbox_xml: xmlPath, music_root: musicRoot })
      .then(applyStatus)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not start the import.'),
      )
      .finally(() => setSubmitting(false))
  }

  const formDisabled = submitting || browsing || running

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-setup-title"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-theme-line bg-float p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-theme p-2">
            <Library className="size-4 text-accent-ink" />
          </span>
          <div>
            <h2 id="library-setup-title" className="text-sm font-semibold text-ink">
              {status.configured ? 'Library setup' : 'Set up your library'}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              SmartDJ reads your Rekordbox collection and plays the audio files
              straight from this Mac. Both paths are saved on this computer only.
            </p>
          </div>
        </div>

        <PathField
          label="Rekordbox XML export"
          hint="In Rekordbox, choose File → Export Collection in xml format."
          value={xmlPath}
          placeholder="/Users/you/Documents/rekordbox.xml"
          icon={FileCode2}
          disabled={formDisabled}
          onChange={setXmlPath}
          onBrowse={() => browse('xml')}
        />
        <PathField
          label="Music folder"
          hint="The folder that holds your audio files. Tracks whose saved location has moved are looked up here."
          value={musicRoot}
          placeholder="/Users/you/Music/DJ"
          icon={FolderOpen}
          disabled={formDisabled}
          onChange={setMusicRoot}
          onBrowse={() => browse('folder')}
        />

        {running && <ImportProgress job={job} />}
        {job.state === 'done' && job.message && (
          <p className="text-xs text-ink-muted">{job.message}</p>
        )}
        {job.state === 'error' && job.message && (
          <p className="text-xs text-danger">Import failed: {job.message}</p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {canClose && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={secondaryButtonClass}
            >
              {running
                ? 'Continue in background'
                : status.configured
                  ? 'Close'
                  : 'Not now'}
            </button>
          )}
          <button
            type="submit"
            disabled={formDisabled || !xmlPath.trim() || !musicRoot.trim()}
            className={cn(primaryButtonClass, 'flex items-center gap-1.5')}
          >
            {submitting && <LoaderCircle className="size-3.5 animate-spin" />}
            {status.configured ? 'Re-import library' : 'Import library'}
          </button>
        </div>
      </form>
    </div>
  )
}
