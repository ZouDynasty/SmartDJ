export const PANEL_LAYOUT_KEY = 'smartdj.panelLayout'

export const DEFAULT_SIDEBAR_WIDTH = 320
export const MIN_SIDEBAR_WIDTH = 240
export const MAX_SIDEBAR_WIDTH = 640
export const MIN_MAIN_WIDTH = 480

export const DEFAULT_GRAPH_HEIGHT = 320
export const MIN_GRAPH_HEIGHT = 160
export const MIN_LIBRARY_HEIGHT = 180

export interface PanelLayout {
  sidebarWidth: number
  graphHeight: number
}

export function loadPanelLayout(): PanelLayout {
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY)
    if (!raw) {
      return {
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        graphHeight: DEFAULT_GRAPH_HEIGHT,
      }
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        graphHeight: DEFAULT_GRAPH_HEIGHT,
      }
    }
    const record = parsed as Partial<PanelLayout>
    return {
      sidebarWidth:
        typeof record.sidebarWidth === 'number'
          ? record.sidebarWidth
          : DEFAULT_SIDEBAR_WIDTH,
      graphHeight:
        typeof record.graphHeight === 'number'
          ? record.graphHeight
          : DEFAULT_GRAPH_HEIGHT,
    }
  } catch {
    return {
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      graphHeight: DEFAULT_GRAPH_HEIGHT,
    }
  }
}

export function persistPanelLayout(layout: PanelLayout): void {
  localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout))
}

export function clampSidebarWidth(width: number, viewportWidth = window.innerWidth): number {
  const max = Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_MAIN_WIDTH),
  )
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), max)
}

export function clampGraphHeight(
  height: number,
  column: HTMLElement | null,
): number {
  if (!column) {
    return Math.max(height, MIN_GRAPH_HEIGHT)
  }
  const nowNext = column.querySelector<HTMLElement>('[data-now-next]')
  const reserved = (nowNext?.offsetHeight ?? 88) + MIN_LIBRARY_HEIGHT + 2
  const max = Math.max(MIN_GRAPH_HEIGHT, column.clientHeight - reserved)
  return Math.min(Math.max(height, MIN_GRAPH_HEIGHT), max)
}
