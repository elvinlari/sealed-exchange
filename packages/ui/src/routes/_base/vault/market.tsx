import { createFileRoute } from '@tanstack/react-router'
import { VaultMarkets } from '@/features/vault/market'

export const Route = createFileRoute('/_base/vault/market')({
  component: VaultMarkets,
})
