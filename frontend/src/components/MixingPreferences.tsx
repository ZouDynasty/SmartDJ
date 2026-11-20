import { useEffect, useState } from 'react'
import { LoaderCircle, SlidersHorizontal, X } from 'lucide-react'
import { getMixingPreferences, saveMixingPreferences } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSetStore } from '@/store/useSetStore'
import type {
  MixingFactor,
  MixingImportance,
  MixingPreferences as MixingPreferencesData,
  MixingPreset,
} from '@/types'

/**
 * Each factor wears its field color from index.css, and the slider's accent
 * has to be a literal class so Tailwind can see it.
 */
const FACTORS: {
  id: MixingFactor
  label: string
  hint: string
  text: string
  slider: string
}[] = [
  {
    id: 'bpm',
    label: 'BPM',
    hint: 'How close the tempos are',
    text: 'text-bpm-field',
    slider: 'accent-bpm-field',
  },
  {
    id: 'genre',
    label: 'Genre',
    hint: 'How similar the genres are',
    text: 'text-genre-field',
    slider: 'accent-genre-field',
  },
  {
    id: 'key',
    label: 'Key',
    hint: 'How well the keys blend on the Camelot wheel',
    text: 'text-key-field',
    slider: 'accent-key-field',
  },
  {
    id: 'energy',
    label: 'Energy',
    hint: 'How little the energy level jumps',
    text: 'text-energy-field',
    slider: 'accent-energy-field',
  },
]

const secondaryButtonClass =
  'flex shrink-0 items-center gap-1.5 rounded-lg border border-theme-line bg-theme-raised px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-theme disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass =
  'flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

function total(importance: MixingImportance): number {
  return FACTORS.reduce((sum, { id }) => sum + importance[id], 0)
}

/** Share of the total each factor will get; the sliders needn't add up to anything. */
function shares(importance: MixingImportance): MixingImportance {
  const sum = total(importance)
  const result = { ...importance }
  for (const { id } of FACTORS) {
    result[id] = sum > 0 ? importance[id] / sum : 0
  }
  return result
}

function sameProportions(a: MixingImportance, b: MixingImportance): boolean {
  if (total(a) === 0 || total(b) === 0) return false
  const left = shares(a)
  const right = shares(b)
  return FACTORS.every(({ id }) => Math.abs(left[id] - right[id]) < 0.005)
}

function sameValues(a: MixingImportance, b: MixingImportance): boolean {
  return FACTORS.every(({ id }) => a[id] === b[id])
}

function PresetButton({
  preset,
  isDefault,
  selected,
  onSelect,
}: {
  preset: MixingPreset
  isDefault: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-accent bg-theme-raised shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-theme-line bg-raised hover:bg-theme',
      )}
    >
      <span className="text-xs font-semibold text-ink">
        {preset.label}
        {isDefault && (
          <span className="ml-1.5 font-normal text-ink-faint">(Default)</span>
        )}
      </span>
      <span className="flex gap-2 font-mono text-[11px]">
        {FACTORS.map(({ id, label, text }) => (
          <span key={id} className={text} title={label}>
            {preset.importance[id]}%
          </span>
        ))}
      </span>
    </button>
  )
}

/**
 * Lets the DJ say how much BPM, genre, key and energy matter in a transition,
 * either through a preset or one slider per factor. The API normalizes the
 * sliders and writes the weights into the ml config, which the compatibility
 * ranking and the mix path both read.
 */
export function MixingPreferences() {
  const open = useSetStore((state) => state.mixingOpen)
  const setOpen = useSetStore((state) => state.setMixingOpen)
  const bumpMixingVersion = useSetStore((state) => state.bumpMixingVersion)

  const [saved, setSaved] = useState<MixingPreferencesData | null>(null)
  const [draft, setDraft] = useState<MixingImportance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-read on every open so the panel always reflects what the API applied.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoadError(null)
    setSaveError(null)
    getMixingPreferences(controller.signal)
      .then((next) => {
        setSaved(next)
        setDraft(next.importance)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(
          cause instanceof Error ? cause.message : 'Could not load mixing preferences.',
        )
      })
    return () => controller.abort()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, setOpen])

  if (!open) return null

  const ready = saved !== null && draft !== null
  const unchanged = ready && sameValues(draft, saved.importance)
  const allZero = ready && total(draft) === 0
  const activePreset = ready
    ? (saved.presets.find((preset) => sameProportions(preset.importance, draft))?.id ??
      null)
    : null
  const draftShares = draft ? shares(draft) : null

  const apply = () => {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    saveMixingPreferences(draft)
      .then(() => {
        bumpMixingVersion()
        setOpen(false)
      })
      .catch((cause: unknown) =>
        setSaveError(
          cause instanceof Error ? cause.message : 'Could not save mixing preferences.',
        ),
      )
      .finally(() => setSaving(false))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mixing-preferences-title"
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-theme-line bg-float p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-theme p-2">
            <SlidersHorizontal className="size-4 text-accent-ink" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="mixing-preferences-title"
              className="text-sm font-semibold text-ink"
            >
              Mixing preferences
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Choose how much each factor matters when judging a transition. It
              shapes the compatible-track scores and the mix path.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        {loadError && <p className="text-xs text-danger">{loadError}</p>}

        {!ready && !loadError && (
          <p className="flex items-center gap-1.5 py-6 text-xs text-ink-muted">
            <LoaderCircle className="size-3.5 animate-spin" />
            Loading…
          </p>
        )}

        {ready && draftShares && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink">Presets</span>
              <div
                role="radiogroup"
                aria-label="Mixing presets"
                className="grid grid-cols-2 gap-2"
              >
                {saved.presets.map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    isDefault={preset.id === saved.default_preset}
                    selected={preset.id === activePreset}
                    onSelect={() => setDraft(preset.importance)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-ink">
                  {activePreset === null ? 'Custom mix' : 'Fine-tune'}
                </span>
                <span className="text-[11px] text-ink-faint">
                  Sliders are relative; they don&apos;t need to add up to 100.
                </span>
              </div>
              {FACTORS.map(({ id, label, hint, text, slider }) => (
                <label key={id} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn('text-xs font-semibold', text)}>
                      {label}
                      <span className="ml-2 font-normal text-ink-muted">{hint}</span>
                    </span>
                    <span className={cn('font-mono text-xs', text)}>
                      {Math.round(draftShares[id] * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={draft[id]}
                    onChange={(event) =>
                      setDraft({ ...draft, [id]: Number(event.target.value) })
                    }
                    aria-label={`${label} importance`}
                    className={cn('h-1 w-full cursor-pointer', slider)}
                  />
                </label>
              ))}
            </div>

            {allZero && (
              <p className="text-xs text-danger">
                Move at least one slider to the right.
              </p>
            )}
          </>
        )}

        {saveError && <p className="text-xs text-danger">{saveError}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!ready || unchanged || allZero || saving}
            className={primaryButtonClass}
          >
            {saving && <LoaderCircle className="size-3.5 animate-spin" />}
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
