import { createFileRoute } from '@tanstack/react-router'
import { VaultAuditors } from '@/features/vault/auditor'

export const Route = createFileRoute('/_base/vault/auditor')({
  component: VaultAuditors,
})
