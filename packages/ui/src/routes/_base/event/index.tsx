import { createFileRoute } from '@tanstack/react-router'
import { Events } from '@/features/event'

export const Route = createFileRoute('/_base/event/')({
  component: Events,
})
