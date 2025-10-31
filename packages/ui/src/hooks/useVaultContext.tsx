import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { useWalletStore } from '@/stores/wallet-store';
import { createFhevmInstance } from '@sealed-exchange/fhevm-sdk';

export type AssetData = {
  id: string;
  token: string;
  tokenName: string;
  tokenSymbol: string;
  enabled: boolean;
  paused: boolean;
  isNumeraire: boolean;
};

export type VaultInfo = {
  admin: string;
  isAdmin: boolean;
  isAuditor: boolean;
  auditorRole: string;
  auditors: string[];
  assets: AssetData[];
  markets: string[];
  totalAssets: number;
  totalMarkets: number;
  totalAuditors: number;
};

export type VaultBalances = {
  availableCiphertext: string;
  reservedCiphertext: string;
};

export type VaultContextType = {
  vaultInfo: VaultInfo | null;
  setVaultInfo: React.Dispatch<React.SetStateAction<VaultInfo | null>>;
  loadVaultInfo: () => Promise<void>;
  depositToVault: (assetId: string, tokenAddress: string, amount: string, decimals: number) => Promise<void>;
  withdrawFromVault: (assetId: string, tokenAddress: string, amount: string, decimals: number) => Promise<void>;
  fetchVaultBalances: (assetId: string) => Promise<VaultBalances>;
  vaultAddress: string;
  vaultAbi: string[];
  status: string;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  error: { title: string; description: string } | null;
  setError: React.Dispatch<React.SetStateAction<{ title: string; description: string } | null>>;
  isLoadingVault: boolean;
};

export const VaultContext = createContext<VaultContextType | null>(null);

export function useVaultContext() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVaultContext must be used within VaultContextProvider');
  }
  return context;
}

// Load Vault address from environment variables
const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS;

if (!VAULT_ADDRESS) {
  throw new Error('VITE_VAULT_ADDRESS is not defined in environment variables');
}

const vaultAbi = [
  "function admin() view returns (address)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function AUDITOR_ROLE() view returns (bytes32)",
  
  // Asset management
  "function registerAsset(bytes32 assetId, address token, bool isNumeraire)",
  "function setAssetStatus(bytes32 assetId, bool enabled, bool paused)",
  "function getAsset(bytes32 assetId) view returns (address token, bool enabled, bool paused, bool isNumeraire)",
  "function assetCount() view returns (uint256)",
  "function assetAt(uint256 index) view returns (bytes32)",
  "function listAssets(uint256 offset, uint256 limit) view returns (bytes32[] ids, address[] tokens, bool[] enabled, bool[] paused, bool[] isNumeraire)",
  
  // Market management
  "function isMarket(address) view returns (bool)",
  "function setMarketApproved(address market, bool approved)",
  "function marketCount() view returns (uint256)",
  "function marketAt(uint256 index) view returns (address)",
  "function listMarkets(uint256 offset, uint256 limit) view returns (address[] markets)",
  
  // Auditor management
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function grantAuditorRole(address auditor)",
  "function revokeAuditorRole(address auditor)",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function auditorCount() view returns (uint256)",
  "function listAuditors(uint256 offset, uint256 limit) view returns (address[] page, uint256 total)",
  
  // Deposit/Withdraw
  "function depositWithPermit(bytes32 assetId, bytes32 encAmount, bytes calldata inputProof, (address owner,address spender,bytes32 amountHash,uint256 deadline,bytes32 salt) p, bytes calldata sig)",
  "function deposit(bytes32 assetId, bytes32 encAmount, bytes calldata inputProof)",
  "function withdraw(bytes32 assetId, bytes32 encAmount, bytes calldata inputProof)",
  
  // Balance queries
  "function selfGetBalancesForCaller(bytes32 assetId) returns (bytes32 eAvailable, bytes32 eReservedAgg)",
];

type VaultContextProviderProps = {
  children: ReactNode;
};

export function VaultContextProvider({ children }: VaultContextProviderProps) {
  const { provider, signer, account } = useWalletStore();
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [isLoadingVault, setIsLoadingVault] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<{ title: string; description: string } | null>(null);

  const loadVaultInfo = async () => {
    if (!provider || !account) {
      setVaultInfo(null);
      return;
    }

    setIsLoadingVault(true);
    setError(null);

    try {
      const contract = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

      // Check admin role
      const adminAddress = await contract.admin();
      const isAdmin = account.toLowerCase() === adminAddress.toLowerCase();

      // Check auditor role
      const auditorRole = await contract.AUDITOR_ROLE();
      const isAuditor = await contract.hasRole(auditorRole, account);

      // Get counts
      const [totalAssets, totalMarkets] = await Promise.all([
        contract.assetCount(),
        contract.marketCount(),
      ]);

      let totalAuditors = 0n;
      try {
        const countFn = contract.getFunction('auditorCount');
        totalAuditors = await countFn.staticCall({ from: account });
      } catch (e) {
        console.warn('auditorCount() staticCall reverted; defaulting to 0');
      }

      // Initial empty arrays (will be loaded by child components with pagination)
      const assets: AssetData[] = [];
      const markets: string[] = [];
      const auditors: string[] = [];

      setVaultInfo({
        admin: adminAddress,
        isAdmin,
        isAuditor,
        auditorRole,
        totalAssets: Number(totalAssets),
        totalMarkets: Number(totalMarkets),
        totalAuditors: Number(totalAuditors),
        assets,
        markets,
        auditors,
      });
    } catch (err: any) {
      console.error("Error loading vault info:", err);
      setError({
        title: "Failed to Load Vault",
        description: err.message || "Could not load vault information"
      });
      setVaultInfo(null);
    } finally {
      setIsLoadingVault(false);
    }
  };

  // Deposit to vault using transferEncryptedAndNotify
  const depositToVault = async (assetId: string, tokenAddress: string, amount: string, decimals: number) => {
    if (!provider || !signer || !account) {
      throw new Error('Wallet not connected');
    }

    setStatus('Preparing deposit...');
    setError(null);

    try {
      // Create FHEVM instance
      const eip1193 = {
        request: async ({ method, params }: { method: string; params?: any[] }) =>
          (provider as any).send(method, params ?? [])
      };
      const fhe = await createFhevmInstance({
        provider: eip1193 as any,
        signal: new AbortController().signal,
        mockChains: undefined
      });

      // Parse amount to the correct decimal places
      const rawAmount = ethers.parseUnits(amount, decimals);

      // Validate uint64 range
      const MAX_UINT64 = (1n << 64n) - 1n;
      if (rawAmount < 0n || rawAmount > MAX_UINT64) {
        throw new Error(`Amount won't fit uint64: ${rawAmount}`);
      }

      // Create encrypted input bound to the TOKEN contract (not vault)
      const enc = await (fhe as any)
        .createEncryptedInput(tokenAddress, account)
        .add64(rawAmount)
        .encrypt();

      if (!enc || !enc.handles || enc.handles.length === 0) {
        throw new Error('Encryption failed: no handles returned');
      }

      // Convert handle to hex string if needed
      let handleHex = enc.handles[0];
      if (handleHex instanceof Uint8Array || Buffer.isBuffer(handleHex)) {
        handleHex = '0x' + Array.from(handleHex).map(b => b.toString(16).padStart(2, '0')).join('');
      }

      // Convert inputProof to hex string if needed
      let inputProof = enc.inputProof;
      if (inputProof instanceof Uint8Array || Buffer.isBuffer(inputProof)) {
        inputProof = '0x' + Array.from(inputProof).map(b => b.toString(16).padStart(2, '0')).join('');
      }

      console.log('Encrypted handle (hex):', handleHex);
      console.log('Input proof (hex):', inputProof);

      // Execute transferEncryptedAndNotify on the token contract
      const tokenContract = new ethers.Contract(tokenAddress, [
        'function transferEncryptedAndNotify(address vault, bytes32 assetId, bytes32 encAmount, bytes inputProof) returns (bool)',
      ], signer);

      setStatus('Depositing to vault...');
      const tx = await tokenContract.transferEncryptedAndNotify(
        VAULT_ADDRESS,  // vault
        assetId,        // assetId
        handleHex,      // encAmount (bytes32)
        inputProof      // inputProof
      );
      
      setStatus('Waiting for confirmation...');
      await tx.wait();
      
      setStatus('Deposit successful!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      console.error("Deposit error:", err);
      
      // Extract detailed error information
      let errorTitle = "Deposit Failed";
      let errorDescription = "An unexpected error occurred";
      
      if (err?.code === 'ACTION_REJECTED') {
        errorTitle = "Transaction Rejected";
        errorDescription = "You rejected the transaction in your wallet";
      } else if (err?.reason) {
        errorDescription = err.reason;
      } else if (err?.data?.message) {
        errorDescription = err.data.message;
      } else if (err?.message) {
        // Clean up common error messages
        if (err.message.includes('user rejected')) {
          errorTitle = "Transaction Rejected";
          errorDescription = "You rejected the transaction";
        } else if (err.message.includes('insufficient funds')) {
          errorTitle = "Insufficient Funds";
          errorDescription = "You don't have enough funds for this transaction";
        } else if (err.message.includes('ASSET_DISABLED')) {
          errorTitle = "Asset Not Available";
          errorDescription = "This asset is currently disabled or paused in the vault";
        } else if (err.message.includes('PERMIT_EXPIRED')) {
          errorTitle = "Permit Expired";
          errorDescription = "The permit has expired, please try again";
        } else if (err.message.includes('INVALID_SIG')) {
          errorTitle = "Invalid Signature";
          errorDescription = "The permit signature is invalid";
        } else if (err.message.includes('AMOUNT_HASH_MISMATCH')) {
          errorTitle = "Amount Mismatch";
          errorDescription = "The encrypted amount hash doesn't match";
        } else {
          errorDescription = err.message;
        }
      }
      
      setError({
        title: errorTitle,
        description: errorDescription
      });
      
      setStatus('');
      // Re-throw so the component's catch block is triggered
      throw err;
    }
  };

  // Withdraw from vault
  const withdrawFromVault = async (assetId: string, _tokenAddress: string, amount: string, decimals: number) => {
    if (!provider || !signer || !account) {
      throw new Error('Wallet not connected');
    }

    setStatus('Preparing withdrawal...');
    setError(null);

    try {
      // Create FHEVM instance
      const providerForSdk = provider ?? new ethers.JsonRpcProvider(
        (import.meta.env.VITE_RPC_URL as string) ?? 'http://127.0.0.1:8545'
      );
      const fhe = await createFhevmInstance({ 
        provider: { 
          request: (p: any) => (providerForSdk as any).send(p.method, p.params) 
        } as any, 
        signal: new AbortController().signal, 
        mockChains: undefined 
      });

      // Parse amount to the correct decimal places
      const rawAmount = ethers.parseUnits(amount, decimals);
      
      // Create encrypted input
      const enc = await (fhe as any)
        .createEncryptedInput(VAULT_ADDRESS, account)
        .add64(rawAmount)
        .encrypt();
      
      const handle = enc.handles[0];
      const inputProof = enc.inputProof;

      // Execute withdrawal
      const vaultContract = new ethers.Contract(VAULT_ADDRESS, vaultAbi, signer);
      
      setStatus('Withdrawing from vault...');
      const tx = await vaultContract.withdraw(assetId, handle, inputProof);
      
      setStatus('Waiting for confirmation...');
      await tx.wait();
      
      setStatus('Withdrawal successful!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      console.error("Withdrawal error:", err);
      
      // Extract detailed error information
      let errorTitle = "Withdrawal Failed";
      let errorDescription = "An unexpected error occurred";
      
      if (err?.code === 'ACTION_REJECTED') {
        errorTitle = "Transaction Rejected";
        errorDescription = "You rejected the transaction in your wallet";
      } else if (err?.reason) {
        errorDescription = err.reason;
      } else if (err?.data?.message) {
        errorDescription = err.data.message;
      } else if (err?.message) {
        // Clean up common error messages
        if (err.message.includes('user rejected')) {
          errorTitle = "Transaction Rejected";
          errorDescription = "You rejected the transaction";
        } else if (err.message.includes('insufficient funds')) {
          errorTitle = "Insufficient Funds";
          errorDescription = "You don't have enough available balance to withdraw";
        } else if (err.message.includes('ASSET_DISABLED')) {
          errorTitle = "Asset Not Available";
          errorDescription = "This asset is currently disabled or paused in the vault";
        } else if (err.message.includes('INSUFFICIENT_AVAILABLE')) {
          errorTitle = "Insufficient Balance";
          errorDescription = "You don't have enough available balance to withdraw this amount";
        } else {
          errorDescription = err.message;
        }
      }
      
      setError({
        title: errorTitle,
        description: errorDescription
      });
      
      setStatus('');
      // Re-throw so the component's catch block is triggered
      throw err;
    }
  };

  // Fetch vault balances for a specific asset (returns ciphertexts only, no decryption)
  const fetchVaultBalances = async (assetId: string): Promise<VaultBalances> => {
    if (!provider || !account) {
      throw new Error('Wallet not connected');
    }

    try {
      // Create vault contract instance
      const vaultContract = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

      // Call selfGetBalancesForCaller via staticCall to get encrypted balances
      // This doesn't send a transaction, just simulates it to get return values
      const [availableCiphertext, reservedCiphertext] = await vaultContract.selfGetBalancesForCaller.staticCall(
        assetId,
        { from: account }
      );

      console.log('Encrypted balances (ciphertexts):', { 
        available: availableCiphertext, 
        reserved: reservedCiphertext 
      });

      return {
        availableCiphertext: availableCiphertext || '0x',
        reservedCiphertext: reservedCiphertext || '0x',
      };
    } catch (err: any) {
      console.error('Error fetching vault balances:', err);
      throw new Error(err?.message || 'Failed to fetch vault balances');
    }
  };

  // Load vault info when provider or account changes
  useEffect(() => {
    loadVaultInfo();
  }, [provider, account]);

  const value: VaultContextType = {
    vaultInfo,
    setVaultInfo,
    loadVaultInfo,
    depositToVault,
    withdrawFromVault,
    fetchVaultBalances,
    vaultAddress: VAULT_ADDRESS,
    vaultAbi,
    status,
    setStatus,
    error,
    setError,
    isLoadingVault,
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
}
