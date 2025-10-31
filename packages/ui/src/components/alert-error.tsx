import { AlertCircleIcon, XIcon } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"

type AlertErrorProps = {
  title: string
  description: string
  onDismiss?: () => void
}

export default function AlertError({ title, description, onDismiss }: AlertErrorProps) {
  return (
    <div className="w-full px-4 lg:px-6 pt-4 pb-2 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="mx-auto max-w-4xl">
        <Alert 
          variant="destructive" 
          className="relative shadow-lg border-l-4 border-l-red-600 dark:border-l-red-500 bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-950/40 dark:to-red-950/20"
        >
          <AlertCircleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
          <div className="flex-1">
            <AlertTitle className="text-base font-semibold text-red-900 dark:text-red-200 mb-1">
              {title}
            </AlertTitle>
            <AlertDescription className="text-sm text-red-800 dark:text-red-300 leading-relaxed">
              {description}
            </AlertDescription>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="absolute top-3 right-3 p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              aria-label="Dismiss alert"
            >
              <XIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
            </button>
          )}
        </Alert>
      </div>
    </div>
  )
}