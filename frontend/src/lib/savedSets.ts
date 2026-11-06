import { supabase } from '@/lib/supabase'
import type { SavedSet } from '@/types'

/** Where sets lived before Supabase. Imported once on sign-in, then removed. */
const LEGACY_SAVED_SETS_KEY = 'smartdj.savedSets'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Row-level security limits every query to the signed-in user's rows. */
export async function fetchSavedSets(): Promise<SavedSet[]> {
  const { data, error } = await supabase
    .from('saved_sets')
    .select('id, name, track_ids, saved_at')
    .order('saved_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as SavedSet[]
}

/** Insert, or overwrite the row with the same `id`. */
export async function upsertSavedSets(sets: SavedSet[]): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign in to save sets')
  const { error } = await supabase
    .from('saved_sets')
    .upsert(sets.map((set) => ({ ...set, user_id: userId })))
  if (error) throw new Error(error.message)
}

export async function deleteSavedSetRow(id: string): Promise<void> {
  const { error } = await supabase.from('saved_sets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Copy sets saved in this browser before Supabase into the signed-in account. */
export async function importLegacySavedSets(): Promise<void> {
  const legacy = loadLegacySavedSets()
  if (legacy.length > 0) {
    await upsertSavedSets(
      legacy.map((set) =>
        UUID_PATTERN.test(set.id) ? set : { ...set, id: crypto.randomUUID() },
      ),
    )
  }
  localStorage.removeItem(LEGACY_SAVED_SETS_KEY)
}

function loadLegacySavedSets(): SavedSet[] {
  try {
    const raw = localStorage.getItem(LEGACY_SAVED_SETS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedSet)
  } catch {
    return []
  }
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
