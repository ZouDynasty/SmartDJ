import { Disc3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackArtworkUrl } from '@/lib/api'

interface ArtworkProps {
  trackId: number
  /** Accessible label; the image itself is decorative over the fallback. */
  title: string
  className?: string
}

/**
 * Album cover with a layered fallback: the placeholder sits underneath, and a
 * cover that fails to load (no embedded artwork) simply leaves it visible.
 * Empty `alt` keeps browsers from drawing a broken-image glyph, so no error
 * state is needed.
 */
export function Artwork({ trackId, title, className }: ArtworkProps) {
  return (
    <div
      role="img"
      aria-label={`Album art for ${title}`}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border border-line bg-raised',
        className,
      )}
    >
      <Disc3 className="absolute inset-0 m-auto size-1/2 text-ink-faint" />
      <img
        src={trackArtworkUrl(trackId)}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
    </div>
  )
}
