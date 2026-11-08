import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Library,
  LogIn,
  LogOut,
  Moon,
  Sun,
  UserRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import type { ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useSetStore } from '@/store/useSetStore'
import type { AuthUser } from '@/types'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const AUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description']

/** Supabase redirects back with `error_description` in the query or hash when sign-in fails. */
function takeAuthError(): string | null {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const error =
    url.searchParams.get('error_description') ?? hash.get('error_description')
  if (error === null) return null
  for (const param of AUTH_ERROR_PARAMS) url.searchParams.delete(param)
  if (hash.has('error_description')) url.hash = ''
  window.history.replaceState(null, '', url)
  return error
}

const buttonClass =
  'flex items-center gap-1.5 rounded-lg border border-theme-line bg-theme-raised px-2.5 py-1 text-xs font-semibold text-ink hover:bg-theme'

function Avatar({ user, size }: { user: AuthUser; size: string }) {
  return user.picture_url ? (
    <img
      src={user.picture_url}
      alt=""
      referrerPolicy="no-referrer"
      className={`${size} rounded-full`}
    />
  ) : (
    <UserRound className={`${size} text-ink-muted`} />
  )
}

function AccountMenu({
  user,
  onLogout,
}: {
  user: AuthUser
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const setSetupOpen = useSetStore((state) => state.setSetupOpen)
  const theme = useTheme((state) => state.theme)
  const setTheme = useTheme((state) => state.setTheme)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={buttonClass}
      >
        <Avatar user={user} size="size-4" />
        Account
        <ChevronDown
          className={`size-3.5 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-theme-line bg-float shadow-lg"
        >
          <div className="flex items-center gap-2.5 border-b border-theme-line px-3 py-2.5">
            <Avatar user={user} size="size-8" />
            <div className="min-w-0">
              {user.name && (
                <div className="truncate text-xs font-semibold text-ink">
                  {user.name}
                </div>
              )}
              <div className="truncate text-xs text-ink-muted" title={user.email}>
                {user.email}
              </div>
            </div>
          </div>
          <div
            role="group"
            aria-label="Appearance"
            className="flex items-center gap-2 border-b border-theme-line px-3 py-2"
          >
            <span className="text-xs font-semibold text-ink">Appearance</span>
            <div className="ml-auto flex overflow-hidden rounded-md border border-theme-line">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs font-semibold',
                    theme === value
                      ? 'bg-accent text-on-accent'
                      : 'text-ink-muted hover:bg-theme hover:text-ink',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setSetupOpen(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-theme"
          >
            <Library className="size-3.5" />
            Library setup
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-theme"
          >
            <LogOut className="size-3.5" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

export function AccountButton() {
  const status = useSetStore((state) => state.auth)
  const [error, setError] = useState<string | null>(takeAuthError)

  if (status === null) return null

  if (!status.configured) {
    return (
      <span className="text-xs text-ink-muted">
        Sign-in is not configured — set <code>SUPABASE_URL</code> in{' '}
        <code>.env</code>
      </span>
    )
  }

  // Supabase redirects to Google and back to this page. App picks up the new
  // session through onAuthStateChange, including after sign-out.
  const handleSignIn = () => {
    supabase.auth
      .signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
        },
      })
      .then(({ error: signInError }) => {
        if (signInError) setError(signInError.message)
      })
  }

  const handleLogout = () => {
    supabase.auth.signOut().then(({ error: signOutError }) => {
      if (signOutError) setError(signOutError.message)
    })
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-danger">Sign-in failed: {error}</span>
      )}
      {status.user ? (
        <AccountMenu user={status.user} onLogout={handleLogout} />
      ) : (
        <button type="button" onClick={handleSignIn} className={buttonClass}>
          <LogIn className="size-3.5" />
          Sign in with Google
        </button>
      )}
    </div>
  )
}
