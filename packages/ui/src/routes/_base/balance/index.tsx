import { createFileRoute } from '@tanstack/react-router'
import { Wallets } from '@/features/balance/wallet'

export const Route = createFileRoute('/_base/balance/')({
  component: Wallets,
})