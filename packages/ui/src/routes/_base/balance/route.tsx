import { createFileRoute } from '@tanstack/react-router'
import { Balance } from '@/features/balance'

export const Route = createFileRoute('/_base/balance')({
  component: Balance,
})
