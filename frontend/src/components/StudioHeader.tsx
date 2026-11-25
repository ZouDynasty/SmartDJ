import { Moon, Sun } from 'lucide-react'
import { AccountButton } from './AccountButton'
import { Logo } from './Logo'
import { useTheme } from '@/lib/theme'

interface Props {
  name: string
  count: number
  duration: string
  library: string
  connected: boolean
}

export function StudioHeader({ name, count, duration, library, connected }: Props) {
  const { theme, setTheme } = useTheme()
  return (
    <header className="studio-nav flex shrink-0 items-center gap-3 bg-theme px-4 py-2.5">
      <Logo className="size-7" />
      <h1 className="shrink-0 text-sm font-semibold tracking-tight">SmartDJ<span className="ml-2 font-normal text-ink-muted">Set Builder</span></h1>
      <span className="session-chip truncate rounded-full border border-theme-line bg-theme-raised px-2.5 py-0.5 font-mono text-xs" title={name}>{name} · {count} in set · {duration}</span>
      <span className="library-status truncate text-xs text-ink-muted" data-connected={connected}>{library}</span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <button type="button" className="rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <AccountButton />
      </div>
    </header>
  )
}
