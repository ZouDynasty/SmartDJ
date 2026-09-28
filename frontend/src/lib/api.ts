import type {
  AuthStatus,
  MixPath,
  Playlist,
  Recommendation,
  Track,
} from '@/types'

export const API_BASE = 'http://localhost:8000/api'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
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
 */
export function trackAudioUrl(trackId: number): string {
  return `${API_BASE}/tracks/${trackId}/audio`
}

/** Album cover embedded in the track's file. 404s when there is none. */
export function trackArtworkUrl(trackId: number): string {
  return `${API_BASE}/tracks/${trackId}/artwork`
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

/**
 * Full-page navigation target, not a fetch: the API redirects to Google and
 * Google redirects back to the API, which then returns to the app.
 */
export const GOOGLE_LOGIN_URL = `${API_BASE}/auth/google/login`

export function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return apiFetch<AuthStatus>('/auth/me', { signal })
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}: /auth/logout`)
  }
}
