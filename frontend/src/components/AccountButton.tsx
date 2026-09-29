import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogIn, LogOut, UserRound } from 'lucide-react'
import { GOOGLE_LOGIN_URL, logout } from '@/lib/api'
import { useSetStore } from '@/store/useSetStore'
import type { AuthUser } from '@/types'

/** The callback redirects back here with `?auth_error=` when Google sign-in fails. */
function takeAuthError(): string | null {
  const url = new URL(window.location.href)
  const error = url.searchParams.get('auth_error')
  if (error === null) return null
  url.searchParams.delete('auth_error')
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
          className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-theme-line bg-theme-raised shadow-lg"
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
  const setAuth = useSetStore((state) => state.setAuth)
  const clearLibrary = useSetStore((state) => state.clearLibrary)
  const [error, setError] = useState<string | null>(takeAuthError)

  if (status === null) return null

  if (!status.configured) {
    return (
      <span className="text-xs text-ink-muted">
        Google sign-in is not configured — set it up in <code>.env</code>
      </span>
    )
  }

  const handleLogout = () => {
    logout()
      .then(() => {
        clearLibrary()
        setAuth({ ...status, user: null, media_token: null })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Log out failed')
      })
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-rose-600">Sign-in failed: {error}</span>
      )}
      {status.user ? (
        <AccountMenu user={status.user} onLogout={handleLogout} />
      ) : (
        <a href={GOOGLE_LOGIN_URL} className={buttonClass}>
          <LogIn className="size-3.5" />
          Sign in with Google
        </a>
      )}
    </div>
  )
}
