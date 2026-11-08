import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

/** Same key the inline script in index.html reads before first paint. */
const STORAGE_KEY = 'smartdj.theme'

function systemTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function storedTheme(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    /* Storage can be blocked; fall back to the OS preference. */
  }
  return systemTheme()
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

interface ThemeState {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

export const useTheme = create<ThemeState>((set) => ({
  theme: storedTheme(),
  setTheme: (theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* Not persisting is fine; the choice still applies this session. */
    }
    applyTheme(theme)
    set({ theme })
  },
}))

applyTheme(useTheme.getState().theme)
