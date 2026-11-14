import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const BAR_COUNT = 28
const FFT_SIZE = 256
/** Share of the spectrum drawn: the top octave is mostly empty on MP3s. */
const USABLE_BINS = 0.75
const SMOOTHING = 0.8
/** Per-frame fall of a bar once the signal drops, so bars settle instead of snapping. */
const FALL_PER_FRAME = 0.06

interface AudioGraph {
  context: AudioContext
  analyser: AnalyserNode
}

/**
 * An audio element can only be wrapped in a source node once, so the graph is
 * remembered per element. React StrictMode runs effects twice in development.
 */
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>()

function graphFor(audio: HTMLAudioElement): AudioGraph | null {
  const existing = graphs.get(audio)
  if (existing) return existing
  try {
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = SMOOTHING
    // Once wrapped, the element only sounds through the graph, so it must end at the speakers.
    context.createMediaElementSource(audio).connect(analyser)
    analyser.connect(context.destination)
    const graph = { context, analyser }
    graphs.set(audio, graph)
    return graph
  } catch {
    return null
  }
}

/** Log-ish spread: low bins get fewer bars' worth of width than the highs. */
function binRange(bar: number, binCount: number): [number, number] {
  const usable = binCount * USABLE_BINS
  const start = Math.floor(Math.pow(bar / BAR_COUNT, 1.7) * usable)
  const end = Math.max(
    start + 1,
    Math.floor(Math.pow((bar + 1) / BAR_COUNT, 1.7) * usable),
  )
  return [start, end]
}

/**
 * Small live spectrum for the track in the transport bar. Reads the audio
 * element through the Web Audio API, so it needs the stream to be CORS-readable
 * (the `<audio>` carries `crossOrigin="anonymous"`).
 */
export function Visualizer({
  audioRef,
  isPlaying,
  trackId,
  className,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  isPlaying: boolean
  trackId: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const levelsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0))

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return
    const context2d = canvas.getContext('2d')
    if (!context2d) return

    const graph = isPlaying ? graphFor(audio) : (graphs.get(audio) ?? null)
    if (graph && isPlaying) {
      graph.context.resume().catch(() => {})
    }
    const data = graph ? new Uint8Array(graph.analyser.frequencyBinCount) : null

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    context2d.scale(dpr, dpr)

    let color = ''
    let frame = 0
    let handle = 0

    const draw = () => {
      if (frame % 60 === 0) {
        color = getComputedStyle(canvas).getPropertyValue('--color-accent').trim()
      }
      frame += 1

      const levels = levelsRef.current
      if (isPlaying && graph && data) {
        graph.analyser.getByteFrequencyData(data)
        for (let bar = 0; bar < BAR_COUNT; bar += 1) {
          const [start, end] = binRange(bar, data.length)
          let peak = 0
          for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, data[bin])
          const target = peak / 255
          levels[bar] = target > levels[bar] ? target : Math.max(levels[bar] - FALL_PER_FRAME, target)
        }
      } else {
        for (let bar = 0; bar < BAR_COUNT; bar += 1) {
          levels[bar] = Math.max(levels[bar] - FALL_PER_FRAME, 0)
        }
      }

      context2d.clearRect(0, 0, width, height)
      context2d.fillStyle = color || '#f4a6c6'
      const slot = width / BAR_COUNT
      const barWidth = Math.max(slot - 1.5, 1)
      for (let bar = 0; bar < BAR_COUNT; bar += 1) {
        // A 1px floor keeps the strip visible while idle.
        const barHeight = Math.max(levels[bar] * height, 1)
        context2d.fillRect(bar * slot, height - barHeight, barWidth, barHeight)
      }

      const settled = !isPlaying && levels.every((level) => level === 0)
      if (!settled) handle = requestAnimationFrame(draw)
    }
    handle = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(handle)
    // `trackId` restarts the loop when the transport swaps tracks on the same element.
  }, [audioRef, isPlaying, trackId])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
    />
  )
}
