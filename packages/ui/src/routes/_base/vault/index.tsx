import { createFileRoute } from '@tanstack/react-router'

import { VaultAssets } from '@/features/vault/asset'

export const Route = createFileRoute('/_base/vault/')({
  component: VaultAssets,
})