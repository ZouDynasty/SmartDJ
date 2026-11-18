import { supabase } from '@/lib/supabase'
import type { UserPlaylist } from '@/types'

/** Row-level security limits every query to the signed-in user's rows. */
export async function fetchPlaylists(): Promise<UserPlaylist[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('id, name, track_ids, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as UserPlaylist[]
}

/**
 * Insert, or overwrite the row with the same `id`. Timestamps are left to the
 * database, so `created_at` survives an overwrite and `updated_at` is bumped.
 */
export async function upsertPlaylist(playlist: UserPlaylist): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign in to save playlists')
  const { error } = await supabase.from('playlists').upsert({
    id: playlist.id,
    user_id: userId,
    name: playlist.name,
    track_ids: playlist.track_ids,
  })
  if (error) {
    // 23505 is a unique violation: the name index in playlists.sql.
    throw new Error(
      error.code === '23505'
        ? `A playlist named "${playlist.name}" already exists`
        : error.message,
    )
  }
}

export async function deletePlaylistRow(id: string): Promise<void> {
  const { error } = await supabase.from('playlists').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
