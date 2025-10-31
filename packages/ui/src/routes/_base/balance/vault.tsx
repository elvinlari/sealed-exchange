import { createFileRoute } from '@tanstack/react-router'
import { Vault } from '@/features/balance/vault'

export const Route = createFileRoute('/_base/balance/vault')({
  component: Vault,
})
