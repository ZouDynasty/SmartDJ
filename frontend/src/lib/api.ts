import { supabase } from '@/lib/supabase'
import type {
  AuthStatus,
  CompatibilityRanking,
  LibrarySetupStatus,
  MixPath,
  Playlist,
  Recommendation,
  Track,
} from '@/types'

export const API_BASE = 'http://localhost:8000/api'

/** Sends the Supabase access token, which the API verifies on every request. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let detail = `API ${response.status} ${response.statusText}: ${path}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string' && body.detail.trim()) {
        detail = body.detail
      }
    } catch {
      /* keep the status line when the body is not JSON */
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export function getTracks(signal?: AbortSignal): Promise<Track[]> {
  return apiFetch<Track[]>('/tracks', { signal })
}

/** Full detail for one track, including its beatgrid. */
export function getTrack(trackId: number, signal?: AbortSignal): Promise<Track> {
  return apiFetch<Track>(`/tracks/${trackId}`, { signal })
}

/**
 * Streaming URL for a track's local audio file. The server resolves the path
 * from the library's `file_path`, so the browser never sees a filesystem path.
 * `mediaToken` authorizes the request when the audio element does not send
 * the session cookie.
 */
export function trackAudioUrl(trackId: number, mediaToken: string | null): string {
  const url = `${API_BASE}/tracks/${trackId}/audio`
  return mediaToken ? `${url}?${new URLSearchParams({ token: mediaToken })}` : url
}

/** Album cover embedded in the track's file. 404s when there is none. */
export function trackArtworkUrl(trackId: number, mediaToken: string | null): string {
  const url = `${API_BASE}/tracks/${trackId}/artwork`
  return mediaToken ? `${url}?${new URLSearchParams({ token: mediaToken })}` : url
}

/** Saves a 0–5 star rating for one track. */
export function setTrackRating(trackId: number, stars: number): Promise<{ stars: number }> {
  return apiFetch(`/tracks/${trackId}/rating`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars }),
  })
}

export function getPlaylists(signal?: AbortSignal): Promise<Playlist[]> {
  return apiFetch<Playlist[]>('/playlists', { signal })
}

export function getRecommendations(
  trackId: number,
  signal?: AbortSignal,
): Promise<Recommendation[]> {
  const params = new URLSearchParams({ track_id: String(trackId) })
  return apiFetch<Recommendation[]>(`/recommendations?${params}`, { signal })
}

/** Key- and BPM-compatible tracks scored 0-1 against `trackId`, best first. */
export function getCompatible(
  trackId: number,
  signal?: AbortSignal,
): Promise<CompatibilityRanking> {
  const params = new URLSearchParams({ track_id: String(trackId) })
  return apiFetch<CompatibilityRanking>(`/compatible?${params}`, { signal })
}

/**
 * Shortest mixable route between two catalog tracks. Non-empty `genres`
 * restricts the intermediate tracks to those macro genres.
 */
export function getMixPath(
  startId: number,
  goalId: number,
  genres: string[] = [],
  signal?: AbortSignal,
): Promise<MixPath> {
  const params = new URLSearchParams({
    start_id: String(startId),
    goal_id: String(goalId),
  })
  for (const genre of genres) params.append('genres', genre)
  return apiFetch<MixPath>(`/mix-path?${params}`, { signal })
}

export function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return apiFetch<AuthStatus>('/auth/me', { signal })
}

export function getLibrarySetup(signal?: AbortSignal): Promise<LibrarySetupStatus> {
  return apiFetch<LibrarySetupStatus>('/setup', { signal })
}

/** Saves both paths and starts importing the XML in the background. */
export function startLibrarySetup(paths: {
  rekordbox_xml: string
  music_root: string
}): Promise<LibrarySetupStatus> {
  return apiFetch<LibrarySetupStatus>('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paths),
  })
}

/** Records that the setup dialog has been shown so it won't auto-open again. */
export function markLibrarySetupSeen(): Promise<LibrarySetupStatus> {
  return apiFetch<LibrarySetupStatus>('/setup/seen', { method: 'POST' })
}

/**
 * Opens the native macOS picker through the local API, since a browser picker
 * never reveals absolute paths. Resolves to null when the user cancels.
 */
export async function browseForPath(kind: 'xml' | 'folder'): Promise<string | null> {
  const { path } = await apiFetch<{ path: string | null }>('/setup/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
  return path
}
