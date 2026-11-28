import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Check,
  ChevronDown,
  LoaderCircle,
  Metronome,
  Music,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Tags,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
 * Each factor wears its field color from index.css. Tailwind only emits
 * classes it can read literally, so every color class is spelled out here.
 */
const FACTORS: {
  id: MixingFactor
  label: string
  hint: string
  text: string
  slider: string
  fill: string
}[] = [
  {
    id: 'bpm',
    label: 'BPM',
    hint: 'How close the tempos are',
    text: 'text-bpm-field',
    slider: 'accent-bpm-field',
    fill: 'bg-bpm-field',
  },
  {
    id: 'genre',
    label: 'Genre',
    hint: 'How similar the genres are',
    text: 'text-genre-field',
    slider: 'accent-genre-field',
    fill: 'bg-genre-field',
  },
  {
    id: 'key',
    label: 'Key',
    hint: 'How well the keys blend on the Camelot wheel',
    text: 'text-key-field',
    slider: 'accent-key-field',
    fill: 'bg-key-field',
  },
  {
    id: 'energy',
    label: 'Energy',
    hint: 'How little the energy level jumps',
    text: 'text-energy-field',
    slider: 'accent-energy-field',
    fill: 'bg-energy-field',
  },
]

/** Icon and one-line intent for each preset the API serves, keyed by preset id. */
const PRESET_INFO: Record<string, { icon: LucideIcon; description: string }> = {
  balanced: { icon: Scale, description: 'Smooth, well-rounded transitions' },
  harmonic: { icon: Music, description: 'Prioritize musically compatible keys' },
  beatmatch: { icon: Metronome, description: 'Keep transitions close in tempo' },
  genre: { icon: Tags, description: 'Maintain a consistent musical style' },
  energy: { icon: Zap, description: 'Maintain a consistent energy level' },
}

/**
 * Words for a slider's 0-100 weight. The weight itself is untouched; this only
 * changes what the DJ reads.
 */
function importanceLabel(value: number): string {
  if (value <= 0) return 'Ignored'
  if (value < 20) return 'Low'
  if (value < 40) return 'Moderate'
  if (value < 70) return 'High'
  return 'Very High'
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink'

const secondaryButtonClass = cn(
  'flex shrink-0 items-center gap-1.5 rounded-lg border border-theme-line bg-theme-raised px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-theme disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
)
const primaryButtonClass = cn(
  'flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
)

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

/** A preset's relative weights as one bar; the shared legend names the colors. */
function WeightBar({ importance }: { importance: MixingImportance }) {
  return (
    <span aria-hidden className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
      {FACTORS.map(({ id, label, fill }) => (
        <span
          key={id}
          title={label}
          className={cn('min-w-0 rounded-full', fill)}
          style={{ flexGrow: importance[id], flexBasis: 0 }}
        />
      ))}
    </span>
  )
}

function PresetButton({
  preset,
  isDefault,
  selected,
  focusable,
  onSelect,
}: {
  preset: MixingPreset
  isDefault: boolean
  selected: boolean
  /** Roving tabindex: only one radio is a Tab stop. */
  focusable: boolean
  onSelect: () => void
}) {
  const info = PRESET_INFO[preset.id]
  const Icon = info?.icon ?? SlidersHorizontal

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      className={cn(
        'relative flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors',
        focusRing,
        selected
          ? 'border-accent bg-accent/15'
          : 'border-line bg-raised hover:bg-hover',
      )}
    >
      <span className="flex items-center gap-2 pr-5">
        <Icon
          aria-hidden
          className={cn('size-3.5 shrink-0', selected ? 'text-accent-ink' : 'text-ink-muted')}
        />
        <span className="min-w-0 text-xs font-semibold text-ink">
          {preset.label}
          {isDefault && (
            <span className="ml-1.5 font-normal text-ink-faint">Default</span>
          )}
        </span>
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {info && (
        <span className="text-[11px] leading-snug text-ink-muted">{info.description}</span>
      )}
      <WeightBar importance={preset.importance} />
      <span className="sr-only">
        {FACTORS.map(({ id, label }) => `${label}: ${importanceLabel(preset.importance[id])}`).join(
          '. ',
        )}
      </span>
    </button>
  )
}

/**
 * Lets the DJ say how they want to mix, either through a preset or by
 * customizing how much BPM, genre, key and energy matter. The API normalizes
 * the sliders and writes the weights into the ml config, which the
 * compatibility ranking and the mix path both read.
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
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const presetGroupRef = useRef<HTMLDivElement>(null)
  const customizeId = useId()

  // Re-read on every open so the panel always reflects what the API applied.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoadError(null)
    setSaveError(null)
    setCustomizeOpen(false)
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

  // Move focus into the dialog and hand it back to the opener on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => opener?.focus()
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
  // Derived, not stored: nudging a slider drops the preset, and landing on a
  // preset's proportions picks it up again.
  const activePreset = ready
    ? (saved.presets.find((preset) => sameProportions(preset.importance, draft))?.id ??
      null)
    : null
  const isCustom = ready && activePreset === null
  const defaultPreset = ready
    ? saved.presets.find((preset) => preset.id === saved.default_preset)
    : undefined
  const atDefault =
    !defaultPreset || (ready && sameValues(draft, defaultPreset.importance))

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

  /** Radio-group keys: arrows move and select, like native radios. */
  const handlePresetKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!saved) return
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const buttons = Array.from(
      presetGroupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
    )
    const current = buttons.findIndex((button) => button === document.activeElement)
    const next = (Math.max(current, 0) + (forward ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
    setDraft(saved.presets[next].importance)
  }

  /** Keeps Tab inside the modal. */
  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled])',
      ),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The checked radio is the Tab stop; with a custom mix, the first one is.
  const tabStopId = activePreset ?? saved?.presets[0]?.id

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3 sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mixing-preferences-title"
        tabIndex={-1}
        onKeyDown={trapTab}
        className="flex max-h-full w-full max-w-lg flex-col gap-3 rounded-xl bg-float p-4 shadow-xl outline-none sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-theme p-2">
            <SlidersHorizontal aria-hidden className="size-4 text-accent-ink" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="mixing-preferences-title"
              className="text-sm font-semibold text-ink"
            >
              Mixing preferences
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              How do you want to mix? This shapes compatible-track scores and the
              mix path.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className={cn(
              'rounded p-0.5 text-ink-faint hover:bg-hover hover:text-ink',
              focusRing,
            )}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {loadError && (
          <p role="alert" className="text-xs text-danger">
            {loadError}
          </p>
        )}

        {!ready && !loadError && (
          <p className="flex items-center gap-1.5 py-6 text-xs text-ink-muted">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Loading…
          </p>
        )}

        {ready && (
          <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 py-1">
            <section className="flex flex-col gap-2">
              <h3 id="mixing-presets-title" className="text-xs font-semibold text-ink">
                Presets
              </h3>
              <div
                ref={presetGroupRef}
                role="radiogroup"
                aria-labelledby="mixing-presets-title"
                onKeyDown={handlePresetKeys}
                className="grid grid-cols-2 gap-2"
              >
                {saved.presets.map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    isDefault={preset.id === saved.default_preset}
                    selected={preset.id === activePreset}
                    focusable={preset.id === tabStopId}
                    onSelect={() => setDraft(preset.importance)}
                  />
                ))}
              </div>
              <ul
                aria-label="Bar colors"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted"
              >
                <li className="text-ink-faint">Bar shows weight of</li>
                {FACTORS.map(({ id, label, fill }) => (
                  <li key={id} className="flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 rounded-full', fill)} />
                    {label}
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-2 border-t border-line pt-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={customizeOpen}
                  aria-controls={customizeId}
                  onClick={() => setCustomizeOpen((value) => !value)}
                  className={cn(
                    '-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-semibold text-ink hover:bg-hover',
                    focusRing,
                  )}
                >
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'size-3.5 text-ink-muted transition-transform',
                      !customizeOpen && '-rotate-90',
                    )}
                  />
                  Customize priorities
                </button>
                <div className="flex items-center gap-2">
                  {isCustom && (
                    <span
                      role="status"
                      className="flex items-center gap-1 rounded-full bg-chip px-2 py-0.5 text-[11px] font-semibold text-chip-ink"
                    >
                      <SlidersHorizontal aria-hidden className="size-3" />
                      Custom preferences
                    </span>
                  )}
                  {customizeOpen && (
                    <button
                      type="button"
                      onClick={() => defaultPreset && setDraft(defaultPreset.importance)}
                      disabled={atDefault}
                      className={cn(
                        'flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-ink-muted hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                        focusRing,
                      )}
                    >
                      <RotateCcw aria-hidden className="size-3" />
                      Reset to default
                    </button>
                  )}
                </div>
              </div>

              {customizeOpen && (
                <div id={customizeId} className="flex flex-col gap-3 pt-1">
                  {FACTORS.map(({ id, label, hint, text, slider, fill }) => {
                    const sliderId = `${customizeId}-${id}`
                    const level = importanceLabel(draft[id])
                    return (
                      <div key={id} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <label
                            htmlFor={sliderId}
                            className="flex min-w-0 items-baseline gap-2 text-xs"
                          >
                            <span
                              aria-hidden
                              className={cn('size-2 shrink-0 translate-y-px rounded-full', fill)}
                            />
                            <span className={cn('font-semibold', text)}>{label}</span>
                            <span className="truncate text-ink-muted">{hint}</span>
                          </label>
                          <span className="shrink-0 text-xs font-semibold text-ink">
                            {level}
                          </span>
                        </div>
                        <input
                          id={sliderId}
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={draft[id]}
                          onChange={(event) =>
                            setDraft({ ...draft, [id]: Number(event.target.value) })
                          }
                          aria-label={`${label} importance`}
                          aria-valuetext={level}
                          className={cn('h-1 w-full cursor-pointer rounded', slider, focusRing)}
                        />
                      </div>
                    )
                  })}
                  <div
                    aria-hidden
                    className="flex justify-between text-[11px] text-ink-faint"
                  >
                    <span>Less important</span>
                    <span>More important</span>
                  </div>
                </div>
              )}
            </section>

            {allZero && (
              <p role="alert" className="text-xs text-danger">
                Raise at least one priority above Ignored
                {customizeOpen ? '.' : ' — open Customize priorities to adjust.'}
              </p>
            )}
          </div>
        )}

        {saveError && (
          <p role="alert" className="text-xs text-danger">
            {saveError}
          </p>
        )}

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
            {saving && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
