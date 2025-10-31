import { Link, useRouterState } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: {
    title: string
    href: string
    isActive: boolean
    disabled?: boolean
  }[]
  account?: string | null
  onConnect?: () => void
  onDisconnect?: () => void
}

export function TopNav({ className, links, account, onConnect, onDisconnect, ...props }: TopNavProps) {
  const { location } = useRouterState()
  const currentPath = location?.pathname ?? '/'
  return (
    <div className="flex items-center justify-between w-full gap-4">
      <div className="flex items-center gap-4">
        {/* Mobile Menu */}
        <div className='lg:hidden'>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size='icon' variant='outline' className='md:size-7 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/50'>
                <Menu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side='bottom' align='start' className="bg-white/95 dark:bg-gray-950/95 backdrop-blur-md">
              {links.map(({ title, href, disabled }) => {
                const active = currentPath === href || currentPath.startsWith(href + '/')
                return (
                  <DropdownMenuItem key={`${title}-${href}`} asChild>
                    <Link
                      to={href}
                      className={active ? 'text-purple-600 font-medium' : 'text-muted-foreground hover:text-purple-600'}
                      disabled={disabled}
                    >
                      {title}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desktop Navigation */}
        <nav
          className={cn(
            'hidden items-center space-x-2 lg:flex lg:space-x-3 xl:space-x-4',
            className
          )}
          {...props}
        >
          {links.map(({ title, href, disabled }) => {
            const active = currentPath === href || currentPath.startsWith(href + '/')
            return (
              <Link
                key={`${title}-${href}`}
                to={href}
                disabled={disabled}
                className={cn(
                  'relative px-3 py-2 text-sm font-medium transition-all duration-200 rounded-lg',
                  'hover:bg-purple-50 dark:hover:bg-purple-950/30',
                  active 
                    ? 'text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20' 
                    : 'text-muted-foreground hover:text-purple-600 dark:hover:text-purple-400'
                )}
              >
                {title}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Wallet Connection UI */}
      <div className="flex items-center gap-2">
        {account ? (
          <>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 rounded-full border border-purple-200 dark:border-purple-800 shadow-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-lg shadow-green-500/50"></div>
              <span className="text-xs font-mono font-medium bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onDisconnect}
              className="cursor-pointer text-xs font-medium border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={onConnect}
            className="cursor-pointer bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-xs font-medium shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105"
          >
            Connect Wallet
          </Button>
        )}
      </div>
    </div>
  )
}
