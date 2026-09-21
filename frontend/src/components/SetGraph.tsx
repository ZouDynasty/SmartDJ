import { useCallback, useMemo } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DotItemDotProps, TooltipContentProps } from 'recharts'
import { Activity, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CAMELOT_KEYS,
  bpmDomain,
  buildSetPoints,
  camelotLabel,
  formatDuration,
  totalSetDuration,
} from '@/lib/setMath'
import type { SetPoint } from '@/lib/setMath'
import { MAX_ZOOM, MIN_ZOOM, useSetStore } from '@/store/useSetStore'
import type { MetricView } from '@/types'

/** BPM blue, energy black, key grey — readable 2px lines on the white plane. */
const SERIES = {
  bpm: { label: 'BPM', color: '#1d4ed8' },
  energy: { label: 'Energy', color: '#0f172a' },
  key: { label: 'Key', color: '#64748b' },
} as const

const VIEW_OPTIONS: { value: MetricView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bpm', label: 'BPM Only' },
  { value: 'energy', label: 'Energy Only' },
  { value: 'key', label: 'Key Only' },
]

const GRID_COLOR = '#c8d0d8'
const AXIS_COLOR = '#c8d0d8'
const TICK_STYLE = { fill: '#0a0c10', fontSize: 11 } as const
/** Unhighlighted dots sit on raised, one step above the canvas. */
const DOT_FILL = '#f4f6f8'

/** Camelot axis renders every one of the 24 harmonic ticks. */
const KEY_TICKS = CAMELOT_KEYS.map((_, index) => index)
const ENERGY_TICKS = [0, 0.25, 0.5, 0.75, 1]

/** Timeline span used when the set is empty, so the plane still has a scale. */
const EMPTY_SPAN_SEC = 30 * 60

/**
 * Recharts only builds axis maps for charts that have a datum, so the empty
 * state feeds one all-null row. Nothing plots, but axes and grid still render.
 */
const EMPTY_PLACEHOLDER: SetPoint[] = [
  {
    instanceId: '',
    trackId: 0,
    index: 0,
    title: '',
    artist: '',
    keyLabel: '',
    startSec: 0,
    durationSec: 0,
    midpointSec: 0,
    bpm: null,
    energy: null,
    energyRaw: null,
    keyIndex: null,
  },
]

function tickInterval(spanSec: number, targetTicks: number): number {
  const candidates = [15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600]
  for (const candidate of candidates) {
    if (spanSec / candidate <= targetTicks) return candidate
  }
  return 3600
}

function buildTimeTicks(spanSec: number, zoom: number): number[] {
  const interval = tickInterval(spanSec, Math.round(8 * zoom))
  const ticks: number[] = []
  for (let tick = 0; tick <= spanSec + 0.5; tick += interval) {
    ticks.push(tick)
  }
  return ticks
}

function SetTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload as SetPoint | undefined
  if (!point?.instanceId) return null

  return (
    <div className="min-w-52 rounded-lg border border-line bg-panel p-3 shadow-lg shadow-slate-900/15">
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-ink-faint">
          {String(point.index + 1).padStart(2, '0')}
        </span>
        <span className="truncate text-sm font-semibold text-ink">
          {point.title}
        </span>
      </p>
      <p className="mt-0.5 truncate text-xs text-ink-muted">{point.artist}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-faint">BPM</dt>
        <dd className="text-right font-mono" style={{ color: SERIES.bpm.color }}>
          {point.bpm === null ? '—' : point.bpm.toFixed(1)}
        </dd>
        <dt className="text-ink-faint">Key</dt>
        <dd className="text-right font-mono" style={{ color: SERIES.key.color }}>
          {point.keyLabel}
        </dd>
        <dt className="text-ink-faint">Energy</dt>
        <dd
          className="text-right font-mono"
          style={{ color: SERIES.energy.color }}
        >
          {point.energy === null ? '—' : point.energy.toFixed(2)}
        </dd>
        <dt className="text-ink-faint">Midpoint</dt>
        <dd className="text-right font-mono text-ink-muted">
          {formatDuration(point.midpointSec)}
        </dd>
      </dl>
    </div>
  )
}

export function SetGraph({ height }: { height: number }) {
  const activeQueue = useSetStore((state) => state.activeQueue)
  const zoom = useSetStore((state) => state.zoom)
  const zoomIn = useSetStore((state) => state.zoomIn)
  const zoomOut = useSetStore((state) => state.zoomOut)
  const resetZoom = useSetStore((state) => state.resetZoom)
  const metricView = useSetStore((state) => state.metricView)
  const setMetricView = useSetStore((state) => state.setMetricView)
  const highlightedInstanceId = useSetStore(
    (state) => state.highlightedInstanceId,
  )
  const setHighlight = useSetStore((state) => state.setHighlight)

  const points = useMemo(() => buildSetPoints(activeQueue), [activeQueue])
  const chartData = points.length > 0 ? points : EMPTY_PLACEHOLDER
  const totalSec = useMemo(() => totalSetDuration(activeQueue), [activeQueue])
  const spanSec = points.length > 0 ? totalSec : EMPTY_SPAN_SEC
  const timeTicks = useMemo(() => buildTimeTicks(spanSec, zoom), [spanSec, zoom])
  const bpmScale = useMemo(() => bpmDomain(points), [points])

  const isVisible = useCallback(
    (series: keyof typeof SERIES) => metricView === 'all' || metricView === series,
    [metricView],
  )

  /** Hovering a plotted point drives the shared highlight for the queue cards. */
  const handleMove = useCallback(
    (next: { activeTooltipIndex?: number | string | null }) => {
      const index = Number(next.activeTooltipIndex)
      const point = Number.isInteger(index) ? points[index] : undefined
      setHighlight(point ? point.instanceId : null, 'graph')
    },
    [points, setHighlight],
  )

  const handleLeave = useCallback(() => {
    setHighlight(null)
  }, [setHighlight])

  const renderDot = useCallback(
    (series: keyof typeof SERIES) =>
      function Dot({ cx, cy, payload }: DotItemDotProps) {
        if (typeof cx !== 'number' || typeof cy !== 'number') return null
        const point = payload as SetPoint | undefined
        const isActive =
          point !== undefined && point.instanceId === highlightedInstanceId
        return (
          <circle
            cx={cx}
            cy={cy}
            r={isActive ? 7 : 3.5}
            fill={isActive ? SERIES[series].color : DOT_FILL}
            stroke={SERIES[series].color}
            strokeWidth={isActive ? 2.5 : 1.75}
          />
        )
      },
    [highlightedInstanceId],
  )

  return (
    <section
      className="flex shrink-0 flex-col bg-canvas"
      style={{ height }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2 text-ink">
          <Activity className="size-4 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            Set Trajectory
          </h2>
        </div>

        <span className="font-mono text-xs text-ink-muted">
          {activeQueue.length} tracks · {formatDuration(totalSec)}
        </span>

        <div className="ml-auto flex items-center gap-1 rounded-md border border-line bg-raised p-0.5">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMetricView(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                metricView === option.value
                  ? 'bg-theme text-ink'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-line bg-raised p-0.5">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            title="Zoom out"
            className="rounded p-1.5 text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-xs text-ink-muted">
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            title="Zoom in"
            className="rounded p-1.5 text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            title="Reset zoom"
            className="rounded p-1.5 text-ink-muted transition-colors hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 pb-2">
        <div style={{ width: `${100 * zoom}%`, height: '100%', minHeight: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 8, left: 0 }}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
            >
              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 4" />

              <XAxis
                type="number"
                dataKey="midpointSec"
                domain={[0, spanSec]}
                ticks={timeTicks}
                tickFormatter={formatDuration}
                allowDataOverflow
                stroke={AXIS_COLOR}
                tick={TICK_STYLE}
                height={28}
              />

              <YAxis
                yAxisId="bpm"
                orientation="left"
                domain={bpmScale}
                allowDecimals={false}
                stroke={SERIES.bpm.color}
                tick={TICK_STYLE}
                width={44}
              />
              <YAxis
                yAxisId="energy"
                orientation="left"
                domain={[0, 1]}
                ticks={ENERGY_TICKS}
                tickFormatter={(value: number) => value.toFixed(2)}
                stroke={SERIES.energy.color}
                tick={TICK_STYLE}
                width={44}
              />
              <YAxis
                yAxisId="key"
                orientation="right"
                type="number"
                domain={[0, CAMELOT_KEYS.length - 1]}
                ticks={KEY_TICKS}
                tickFormatter={camelotLabel}
                interval={0}
                stroke={SERIES.key.color}
                tick={TICK_STYLE}
                width={44}
              />

              <Tooltip
                content={SetTooltip}
                cursor={{ stroke: '#3d4654', strokeDasharray: '3 3' }}
              />

              <Line
                yAxisId="bpm"
                dataKey="bpm"
                name={SERIES.bpm.label}
                type="monotone"
                stroke={SERIES.bpm.color}
                strokeWidth={2}
                strokeOpacity={isVisible('bpm') ? 1 : 0}
                dot={isVisible('bpm') ? renderDot('bpm') : false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="energy"
                dataKey="energy"
                name={SERIES.energy.label}
                type="monotone"
                stroke={SERIES.energy.color}
                strokeWidth={2}
                strokeOpacity={isVisible('energy') ? 1 : 0}
                dot={isVisible('energy') ? renderDot('energy') : false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="key"
                dataKey="keyIndex"
                name={SERIES.key.label}
                type="linear"
                stroke={SERIES.key.color}
                strokeWidth={2}
                strokeDasharray="5 3"
                strokeOpacity={isVisible('key') ? 1 : 0}
                dot={isVisible('key') ? renderDot('key') : false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {points.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
            Add tracks from the catalog to plot the set trajectory.
          </p>
        )}
      </div>
    </section>
  )
}
