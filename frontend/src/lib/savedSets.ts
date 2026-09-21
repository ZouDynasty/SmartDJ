import type { SavedSet } from '@/types'

export const SAVED_SETS_KEY = 'smartdj.savedSets'

export function loadSavedSets(): SavedSet[] {
  try {
    const raw = localStorage.getItem(SAVED_SETS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedSet)
  } catch {
    return []
  }
}

export function persistSavedSets(sets: SavedSet[]): void {
  localStorage.setItem(SAVED_SETS_KEY, JSON.stringify(sets))
}

function isSavedSet(value: unknown): value is SavedSet {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<SavedSet>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.saved_at === 'string' &&
    Array.isArray(record.track_ids) &&
    record.track_ids.every((id) => typeof id === 'number')
  )
}
