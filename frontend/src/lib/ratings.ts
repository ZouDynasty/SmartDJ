import { requireSupabase } from '@/lib/supabase'
import type { TrackRating } from '@/types'

/** Supabase returns at most this many rows per request. */
const PAGE_SIZE = 1000

/**
 * Every rating the signed-in user has saved. Row-level security limits the
 * query to their own rows; the loop pages past Supabase's row cap so a large
 * library is not silently cut off.
 */
export async function fetchRatings(): Promise<TrackRating[]> {
  const client = requireSupabase()
  const rows: TrackRating[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('track_ratings')
      .select('track_id, stars')
      .order('track_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data as TrackRating[]))
    if (data.length < PAGE_SIZE) return rows
  }
}

/**
 * Insert or overwrite the signed-in user's rating for one track. 0 stars is
 * stored as a row too: it means "cleared", and overrides whatever star count
 * the Rekordbox import carried.
 */
export async function upsertRating(trackId: number, stars: number): Promise<void> {
  const { data } = await requireSupabase().auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign in to rate tracks')
  const { error } = await requireSupabase()
    .from('track_ratings')
    .upsert({ user_id: userId, track_id: trackId, stars }, { onConflict: 'user_id,track_id' })
  if (error) throw new Error(error.message)
}
