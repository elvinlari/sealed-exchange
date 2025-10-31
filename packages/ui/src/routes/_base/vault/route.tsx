import { createFileRoute } from '@tanstack/react-router'
import { Vault } from '@/features/vault'

export const Route = createFileRoute('/_base/vault')({
  component: Vault,
})
