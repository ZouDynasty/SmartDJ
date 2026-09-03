import type { Playlist, Recommendation, Track } from '@/types'

export const API_BASE = 'http://localhost:8000/api'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}: ${path}`)
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
