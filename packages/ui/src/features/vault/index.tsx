import { Main } from '@/components/layout/main';
import { SidebarNav } from '@/components/sidebar-nav';
import { Separator } from '@/components/ui/separator';
import { 
  Vault as VaultIcon, 
  Shield, 
  Users, 
  CheckCircle,
  Package,
  Wallet
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import AlertError from '@/components/alert-error';
import { useWalletStore } from '@/stores/wallet-store';
import { VaultContextProvider, useVaultContext } from '@/hooks/useVaultContext';
import { Outlet } from '@tanstack/react-router'

const sidebarNavItems = [
  {
    title: 'Assets',
    href: '/vault',
    icon: <Package size={18} />
  },
  {
    title: 'Markets',
    href: '/vault/market',
    icon: <CheckCircle size={18} />,
  },
  {
    title: 'Auditors',
    href: '/vault/auditor',
    icon: <Users size={18} />,
  },
]

export function Vault() {
  return (
    <VaultContextProvider>
      <VaultContent />
    </VaultContextProvider>
  );
}

function VaultContent() {
  const { vaultInfo, isLoadingVault, status, error, vaultAddress } = useVaultContext();
  const { account, connectWallet } = useWalletStore();
      
  return (
    <>
      <Main fixed>
        {error && (
            <AlertError
            title={error.title}
            description={error.description}
            />
        )}
        <div className="flex items-center gap-3 mb-2">
            <VaultIcon className="w-8 h-8 text-purple-600 dark:text-purple-400" />
            <h1 className="text-3xl font-bold">Vault Management</h1>
        </div>
        <p className="text-muted-foreground font-mono text-sm">
            {vaultAddress}
        </p>
        {/* Status Message */}
        {status && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-300">{status}</p>
          </div>
        )}
        
        {/* No Wallet Connected State */}
        {!account && !isLoadingVault ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center my-6">
            <Wallet className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <h2 className="text-2xl font-bold mb-2">No Wallet Connected</h2>
            <p className="text-muted-foreground mb-6">
              Connect your wallet to access vault management features
            </p>
            <Button onClick={connectWallet} size="lg" className="cursor-pointer">
              <Wallet className="h-5 w-5 mr-2" />
              Connect Wallet
            </Button>
          </div>
        ) : 
        /* Loading State */
        isLoadingVault ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-8 border border-gray-200 dark:border-gray-800 shadow-sm text-center my-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading vault information...</p>
          </div>
        ) : vaultInfo ? (
          <>
            {/* Vault Info Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
              <div className="bg-white dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <h3 className="font-semibold">Your Role</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {vaultInfo.isAdmin && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      Admin
                    </span>
                  )}
                  {vaultInfo.isAuditor && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Auditor
                    </span>
                  )}
                  {!vaultInfo.isAdmin && !vaultInfo.isAuditor && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                      User
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-white dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-semibold">Registered Assets</h3>
                </div>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {vaultInfo.totalAssets}
                </p>
              </div>

              <div className="bg-white dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <h3 className="font-semibold">Approved Markets</h3>
                </div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {vaultInfo.totalMarkets}
                </p>
              </div>
            </div>

            <Separator className='my-4 lg:my-6' />
            <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
              {/* Sidebar Navigation */}
              <aside className='top-0 lg:sticky lg:w-1/5'>
                <SidebarNav items={sidebarNavItems} />
              </aside>
              
              {/* Content Area */}
              <div className='flex-1 w-full overflow-y-auto p-1'>
                <Outlet />
              </div>
            </div>
          </>
        ) : null}

    </Main>

    </>
  );
}