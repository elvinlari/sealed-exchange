import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    // Add scroll listener to the body
    document.addEventListener('scroll', onScroll, { passive: true })

    // Clean up the event listener on unmount
    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'z-50 h-16 transition-all duration-300',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        offset > 10 && fixed ? 'shadow-lg' : 'shadow-none',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'relative flex h-full items-center gap-3 px-6 sm:gap-4',
          'bg-gradient-to-r from-white via-purple-50/30 to-blue-50/30',
          'dark:from-gray-950 dark:via-purple-950/20 dark:to-blue-950/20',
          'border-b border-purple-200/50 dark:border-purple-800/50',
          offset > 10 &&
            fixed &&
            'backdrop-blur-xl bg-white/95 dark:bg-gray-950/95 shadow-lg'
        )}
      >
        {children}
      </div>
    </header>
  )
}
