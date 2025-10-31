import { create } from 'zustand'
import { ethers } from 'ethers'

interface WalletState {
  provider: any | null
  signer: any | null
  account: string | null
  isConnecting: boolean
  error: string | null
  
  // Actions
  setProvider: (provider: any) => void
  setSigner: (signer: any) => void
  setAccount: (account: string | null) => void
  setError: (error: string | null) => void
  connectWallet: () => Promise<void>
  disconnectWallet: () => Promise<void>
  checkConnection: () => Promise<void>
  reset: () => void
}

export const useWalletStore = create<WalletState>()((set) => ({
  // Initial state
  provider: null,
  signer: null,
  account: null,
  isConnecting: false,
  error: null,

  // Setters
  setProvider: (provider) => set({ provider }),
  setSigner: (signer) => set({ signer }),
  setAccount: (account) => set({ account }),
  setError: (error) => set({ error }),

  // Connect wallet (prompts user)
  connectWallet: async () => {
    set({ isConnecting: true, error: null })
    
    try {
      if (!(window as any).ethereum) {
        throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.')
      }

      const p = new ethers.BrowserProvider((window as any).ethereum)
      const accounts = await p.send("eth_requestAccounts", [])
      const account = accounts && accounts[0]
      
      if (!account) {
        throw new Error('No account found. Please unlock your wallet.')
      }

      const s = await p.getSigner()
      
      set({
        provider: p,
        signer: s,
        account,
        isConnecting: false,
        error: null
      })
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      const isUserRejection = errMsg.toLowerCase().includes('user rejected') || 
                             errMsg.toLowerCase().includes('user denied') ||
                             errMsg.toLowerCase().includes('user cancelled')
      
      const errorMessage = isUserRejection 
        ? 'Connection cancelled by user' 
        : errMsg
      
      set({ 
        error: errorMessage,
        isConnecting: false,
        provider: null,
        signer: null,
        account: null
      })
      
      throw new Error(errorMessage)
    }
  },

  // Check for existing connection (doesn't prompt)
  checkConnection: async () => {
    try {
      if ((window as any).ethereum) {
        const p = new ethers.BrowserProvider((window as any).ethereum)
        set({ provider: p })
        
        const accounts = await p.send("eth_accounts", [])
        if (accounts && accounts.length > 0) {
          const account = accounts[0]
          const s = await p.getSigner()
          set({ 
            signer: s,
            account,
            error: null
          })
        }
      } else {
        // Fallback to RPC provider if no wallet
        const url = (import.meta.env.VITE_RPC_URL as string) ?? "http://127.0.0.1:8545"
        const p = new ethers.JsonRpcProvider(url)
        set({ provider: p })
      }
    } catch (e) {
      console.error('Failed to check wallet connection:', e)
    }
  },

  disconnectWallet: async () => {
    try {
      const eth = (window as any)?.ethereum
      if (eth?.request) {
        // EIP-2255: Revoke permissions for this dapp to access accounts
        await eth.request({
          method: 'wallet_revokePermissions',
          params: [
            {
              eth_accounts: {}
            }
          ]
        })
      }
    } catch (e) {
      console.warn('wallet_revokePermissions failed or unsupported:', e)
    } finally {
      set({
        account: null,
        signer: null,
        error: null
      })
    }
  },

  // Reset entire state
  reset: () => {
    set({
      provider: null,
      signer: null,
      account: null,
      isConnecting: false,
      error: null
    })
  }
}))

// Setup wallet event listeners
if (typeof window !== 'undefined' && (window as any).ethereum) {
  const ethereum = (window as any).ethereum

  // Listen for account changes
  ethereum.on('accountsChanged', (accounts: string[]) => {
    const { setAccount, setSigner, provider, reset } = useWalletStore.getState()
    
    if (accounts.length === 0) {
      // Wallet disconnected
      reset()
    } else if (accounts[0] !== useWalletStore.getState().account) {
      // Account changed
      setAccount(accounts[0])
      if (provider) {
        provider.getSigner().then((s: any) => setSigner(s)).catch(() => {})
      }
    }
  })

  // Listen for chain changes (reload recommended)
  ethereum.on('chainChanged', () => {
    window.location.reload()
  })
}
