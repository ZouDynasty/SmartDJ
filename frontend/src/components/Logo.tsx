import { cn } from '@/lib/utils'

/**
 * The SmartDJ mark. `logo.png` is white on transparent and used as a mask, so
 * the fill follows the theme: set the colour with a `bg-*` class.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="SmartDJ"
      className={cn('inline-block shrink-0 bg-accent-ink', className)}
      style={{
        maskImage: 'url(/logo.png)',
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage: 'url(/logo.png)',
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
