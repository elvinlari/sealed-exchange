"use client";

import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Main } from '@/components/layout/main';
import { Button } from '@/components/ui/button';
import AlertError from '@/components/alert-error';
import { useWalletStore } from '@/stores/wallet-store';
import { Shield, Coins, Flame, UserPlus, RefreshCw, UserMinus, Users, Eye, Copy, Check } from 'lucide-react';
import { decryptValue } from '@/lib/fhevm-decrypt';

// Load token contracts from environment variables
const TOKEN_CONTRACTS = [
  {
    address: import.meta.env.VITE_TOKEN_CUSDT_ADDRESS,
    name: "ConfUSDT",
  },
  {
    address: import.meta.env.VITE_TOKEN_CGOLD_ADDRESS,
    name: "ConfGOLD",
  },
  {
    address: import.meta.env.VITE_TOKEN_CBTC_ADDRESS,
    name: "ConfBTC",
  },
  {
    address: import.meta.env.VITE_TOKEN_CETH_ADDRESS,
    name: "ConfETH",
  },
].filter(token => token.address); // Filter out any undefined values

// Validate that token addresses are configured
if (TOKEN_CONTRACTS.length === 0) {
  console.warn('No token contracts configured in environment variables');
}

const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (bytes32)",
  "function owner() view returns (address)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function mint(address to, uint64 rawAmount)",
  "function burn(uint64 rawAmount)",
  "function grantAuditorRole(address auditor)",
  "function revokeAuditorRole(address auditor)",
  "function auditorCount() view returns (uint256)",
  "function listAuditors(uint256 offset, uint256 limit) view returns (address[] page, uint256 total)",
  "function AUDITOR_ROLE() view returns (bytes32)",
];

type TokenData = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  owner: string;
  isOwner: boolean;
  isAuditor: boolean;
  auditorRole: string;
  auditors: string[];
  totalAuditors: number;
};

export const Admin: React.FC = () => {
  const { provider, signer, account, checkConnection } = useWalletStore();

  // Contract management
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>(TOKEN_CONTRACTS[0]?.address || "");
  const [isLoadingTokens, setIsLoadingTokens] = useState<boolean>(false);
  
  // Pagination for auditors
  const [currentAuditorPage, setCurrentAuditorPage] = useState<number>(1);
  const auditorsPerPage = 5;

  // Form states
  const [mintTo, setMintTo] = useState<string>("");
  const [mintAmount, setMintAmount] = useState<string>("");
  const [burnAmount, setBurnAmount] = useState<string>("");
  const [grantRoleAddress, setGrantRoleAddress] = useState<string>("");

  // UI states
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'info' | 'error' | 'success'; msg: string } | null>(null);
  const [isMinting, setIsMinting] = useState<boolean>(false);
  const [isBurning, setIsBurning] = useState<boolean>(false);
  const [isGranting, setIsGranting] = useState<boolean>(false);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);

  // Decrypted total supply state
  const [decryptedSupply, setDecryptedSupply] = useState<string>("");
  const [isDecryptingSupply, setIsDecryptingSupply] = useState<boolean>(false);

  // Copy state
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Get currently selected token
  const selectedToken = tokens.find(t => t.address === selectedTokenAddress);

  // Copy to clipboard handler
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(label);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Check wallet connection on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Load auditors page when currentAuditorPage changes
  useEffect(() => {
    if (provider && selectedToken?.isOwner) {
      loadAuditorsPage(currentAuditorPage);
    }
  }, [currentAuditorPage, selectedTokenAddress]);

  // Reset to page 1 when changing tokens
  useEffect(() => {
    setCurrentAuditorPage(1);
    setDecryptedSupply(""); // Reset decrypted supply when changing tokens
  }, [selectedTokenAddress]);

  // Load all token contracts
  useEffect(() => {
    const loadAllTokens = async () => {
      if (!provider) return;

      setIsLoadingTokens(true);
      setStatus('Loading token contracts...');

      const loadedTokens: TokenData[] = [];

      for (const tokenConfig of TOKEN_CONTRACTS) {
        try {
          const contract = new ethers.Contract(tokenConfig.address, tokenAbi, provider);
          
          const [name, symbol, dec, owner, role] = await Promise.all([
            contract.name(),
            contract.symbol(),
            contract.decimals(),
            contract.owner(),
            contract.AUDITOR_ROLE(),
          ]);

          // Fetch total supply
          let totalSupply = "0";
          try {
            const supplyBytes = await contract.totalSupply();
            totalSupply = supplyBytes || "0x";
          } catch (e) {
            console.error(`Error fetching total supply for ${name}:`, e);
          }

          const isOwner = account ? account.toLowerCase() === owner.toLowerCase() : false;

          // Check if current account has auditor role
          let isAuditor = false;
          if (account) {
            try {
              isAuditor = await contract.hasRole(role, account);
            } catch (e) {
              console.error(`Error checking auditor role for ${name}:`, e);
            }
          }

          // Load auditors if current account is owner (first page only)
          let auditors: string[] = [];
          let totalAuditors = 0;
          if (isOwner) {
            try {
              const listFn = contract.getFunction('listAuditors');
              const countFn = contract.getFunction('auditorCount');
              const [auditorsData, count] = await Promise.all([
                listFn.staticCall(0, auditorsPerPage, { from: account }),
                countFn.staticCall({ from: account }),
              ]);
              auditors = auditorsData[0]; // First element is the page array
              totalAuditors = Number(count);
            } catch (e) {
              console.error(`Error loading auditors for ${name}:`, e);
            }
          }

          loadedTokens.push({
            address: tokenConfig.address,
            name,
            symbol,
            decimals: Number(dec),
            totalSupply,
            owner,
            isOwner,
            isAuditor,
            auditorRole: role,
            auditors,
            totalAuditors,
          });
        } catch (e: any) {
          console.error(`Error loading token ${tokenConfig.address}:`, e);
        }
      }

      setTokens(loadedTokens);
      setIsLoadingTokens(false);
      setStatus(loadedTokens.length > 0 ? `Loaded ${loadedTokens.length} contract(s)` : 'No contracts loaded');
    };

    loadAllTokens();
  }, [provider, account]);

  // Load auditors page for selected token
  const loadAuditorsPage = async (page: number) => {
    if (!provider || !selectedTokenAddress || !selectedToken?.isOwner) return;

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, provider);
      const offset = (page - 1) * auditorsPerPage;
  const listFn = contract.getFunction('listAuditors');
  const [auditorList] = await listFn.staticCall(offset, auditorsPerPage, { from: account });
      
      setTokens(prev => prev.map(t => 
        t.address === selectedTokenAddress 
          ? { ...t, auditors: auditorList }
          : t
      ));
    } catch (e) {
      console.error('Error loading auditors page:', e);
    }
  };

  // Refresh auditors for selected token (reload current page + count)
  const refreshAuditors = async () => {
    if (!provider || !selectedTokenAddress || !selectedToken?.isOwner) return;

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, provider);
      const offset = (currentAuditorPage - 1) * auditorsPerPage;
      
      // Check if current account has auditor role (might have changed)
      let isAuditor = false;
      if (account) {
        try {
          isAuditor = await contract.hasRole(selectedToken.auditorRole, account);
        } catch (e) {
          console.error('Error checking auditor role:', e);
        }
      }
      
      const listFn = contract.getFunction('listAuditors');
      const countFn = contract.getFunction('auditorCount');
      const [auditorsData, count] = await Promise.all([
        listFn.staticCall(offset, auditorsPerPage, { from: account }),
        countFn.staticCall({ from: account }),
      ]);
      
      setTokens(prev => prev.map(t => 
        t.address === selectedTokenAddress 
          ? { ...t, auditors: auditorsData[0], totalAuditors: Number(count), isAuditor }
          : t
      ));
      
      // Reset to page 1 if current page is now out of bounds
      const totalPages = Math.ceil(Number(count) / auditorsPerPage);
      if (currentAuditorPage > totalPages && totalPages > 0) {
        setCurrentAuditorPage(1);
      }
    } catch (e) {
      console.error('Error refreshing auditors:', e);
    }
  };

  // Decrypt total supply
  const handleDecryptSupply = async () => {
    if (!provider || !signer || !selectedToken) {
      setError({ title: "Connection Required", description: "Please connect your wallet" });
      return;
    }

    setIsDecryptingSupply(true);
    setError(null);

    try {
      const decrypted = await decryptValue(
        selectedToken.totalSupply,
        selectedToken.address,
        selectedToken.decimals,
        provider,
        signer
      );
      setDecryptedSupply(decrypted || "0");
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      setError({ title: 'Decryption Failed', description: errMsg });
    } finally {
      setIsDecryptingSupply(false);
    }
  };

  // Mint tokens
  const handleMint = async () => {
    if (!signer || !selectedToken?.isOwner) {
      setError({ title: "Access Denied", description: "Only the contract owner can mint tokens" });
      return;
    }

    if (!mintTo || !ethers.isAddress(mintTo)) {
      setError({ title: "Invalid Address", description: "Please enter a valid recipient address" });
      return;
    }

    if (!mintAmount || parseFloat(mintAmount) <= 0) {
      setError({ title: "Invalid Amount", description: "Please enter a valid amount to mint" });
      return;
    }

    setIsMinting(true);
    setFeedback({ type: 'info', msg: 'Minting tokens...' });
    setError(null);

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, signer);
      const rawAmount = ethers.parseUnits(mintAmount, selectedToken.decimals);
      
      // Ensure it fits in uint64
      const MAX_UINT64 = (1n << 64n) - 1n;
      if (rawAmount > MAX_UINT64) {
        throw new Error(`Amount too large for uint64. Max: ${ethers.formatUnits(MAX_UINT64, selectedToken.decimals)}`);
      }

      const tx = await contract.mint(mintTo, rawAmount);
      setFeedback({ type: 'info', msg: 'Transaction submitted, waiting for confirmation...' });
      
      await tx.wait();
      
      setFeedback({ type: 'success', msg: `Successfully minted ${mintAmount} ${selectedToken.symbol} to ${mintTo.slice(0, 6)}...${mintTo.slice(-4)}` });
      setMintTo('');
      setMintAmount('');
      setStatus('Mint completed successfully');
    } catch (e: any) {
      const errMsg = e?.reason || e?.message || String(e);
      setError({ title: 'Mint Failed', description: errMsg });
      setFeedback({ type: 'error', msg: errMsg });
    } finally {
      setIsMinting(false);
    }
  };

  // Burn tokens
  const handleBurn = async () => {
    if (!signer || !selectedToken) {
      setError({ title: "Wallet Not Connected", description: "Please connect your wallet to burn tokens" });
      return;
    }

    if (!burnAmount || parseFloat(burnAmount) <= 0) {
      setError({ title: "Invalid Amount", description: "Please enter a valid amount to burn" });
      return;
    }

    setIsBurning(true);
    setFeedback({ type: 'info', msg: 'Burning tokens...' });
    setError(null);

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, signer);
      const rawAmount = ethers.parseUnits(burnAmount, selectedToken.decimals);
      
      const MAX_UINT64 = (1n << 64n) - 1n;
      if (rawAmount > MAX_UINT64) {
        throw new Error(`Amount too large for uint64. Max: ${ethers.formatUnits(MAX_UINT64, selectedToken.decimals)}`);
      }

      const tx = await contract.burn(rawAmount);
      setFeedback({ type: 'info', msg: 'Transaction submitted, waiting for confirmation...' });
      
      await tx.wait();
      
      setFeedback({ type: 'success', msg: `Successfully burned ${burnAmount} ${selectedToken.symbol}` });
      setBurnAmount('');
      setStatus('Burn completed successfully');
    } catch (e: any) {
      const errMsg = e?.reason || e?.message || String(e);
      const isInsufficientBalance = errMsg.toLowerCase().includes('insufficient') || 
                                     errMsg.toLowerCase().includes('exceeds balance');
      
      const displayError = isInsufficientBalance 
        ? 'Insufficient balance to burn this amount' 
        : errMsg;
      
      setError({ title: 'Burn Failed', description: displayError });
      setFeedback({ type: 'error', msg: displayError });
    } finally {
      setIsBurning(false);
    }
  };

  // Grant Auditor Role
  const handleGrantRole = async () => {
    if (!signer || !selectedToken?.isOwner) {
      setError({ title: "Access Denied", description: "Only the contract owner can grant auditor role" });
      return;
    }

    if (!grantRoleAddress || !ethers.isAddress(grantRoleAddress)) {
      setError({ title: "Invalid Address", description: "Please enter a valid address" });
      return;
    }

    setIsGranting(true);
    setFeedback({ type: 'info', msg: 'Granting auditor role...' });
    setError(null);

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, signer);
      
      // Check if address already has the role
      const hasRole = await contract.hasRole(selectedToken.auditorRole, grantRoleAddress);
      if (hasRole) {
        setFeedback({ type: 'info', msg: 'Address already has auditor role' });
        setIsGranting(false);
        return;
      }

      const tx = await contract.grantAuditorRole(grantRoleAddress);
      setFeedback({ type: 'info', msg: 'Transaction submitted, waiting for confirmation...' });
      
      await tx.wait();
      
      setFeedback({ type: 'success', msg: `Successfully granted auditor role to ${grantRoleAddress.slice(0, 6)}...${grantRoleAddress.slice(-4)}` });
      setGrantRoleAddress('');
      setStatus('Role granted successfully');
      
      // Reload auditors list
      await refreshAuditors();
    } catch (e: any) {
      const errMsg = e?.reason || e?.message || String(e);
      setError({ title: 'Grant Role Failed', description: errMsg });
      setFeedback({ type: 'error', msg: errMsg });
    } finally {
      setIsGranting(false);
    }
  };

  // Revoke Auditor Role
  const handleRevokeRole = async (auditorAddress: string) => {
    if (!signer || !selectedToken?.isOwner) {
      setError({ title: "Access Denied", description: "Only the contract owner can revoke auditor role" });
      return;
    }

    setIsRevoking(true);
    setFeedback({ type: 'info', msg: 'Revoking auditor role...' });
    setError(null);

    try {
      const contract = new ethers.Contract(selectedTokenAddress, tokenAbi, signer);
      
      const tx = await contract.revokeAuditorRole(auditorAddress);
      setFeedback({ type: 'info', msg: 'Transaction submitted, waiting for confirmation...' });
      
      await tx.wait();
      
      setFeedback({ type: 'success', msg: `Successfully revoked auditor role from ${auditorAddress.slice(0, 6)}...${auditorAddress.slice(-4)}` });
      setStatus('Role revoked successfully');
      
      // Reload auditors list
      await refreshAuditors();
    } catch (e: any) {
      const errMsg = e?.reason || e?.message || String(e);
      setError({ title: 'Revoke Role Failed', description: errMsg });
      setFeedback({ type: 'error', msg: errMsg });
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <Main>
      {error && (
        <AlertError
          title={error.title}
          description={error.description}
          onDismiss={() => setError(null)}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">
              Manage token minting, burning, and access control
            </p>
          </div>
        </div>

        {/* Contract Selector */}
        {tokens.length > 0 && (
          <div className="bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-purple-950/10 dark:via-gray-900 dark:to-blue-950/10 rounded-lg p-4 border border-purple-200 dark:border-purple-800/50 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/* Selector Section */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
                  <label className="text-xs font-semibold text-purple-900 dark:text-purple-100 uppercase tracking-wide">
                    Active Contract
                  </label>
                </div>
                <select
                  value={selectedTokenAddress}
                  onChange={(e) => setSelectedTokenAddress(e.target.value)}
                  className="w-full p-2.5 border-2 border-purple-200 dark:border-purple-800 rounded-lg bg-white dark:bg-gray-950 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-mono text-sm shadow-sm hover:border-purple-300 dark:hover:border-purple-700"
                >
                  {tokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.name} ({token.symbol}) • {token.address.substring(0, 6)}...{token.address.substring(token.address.length - 4)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Badges Section */}
              {selectedToken && account && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 lg:border-l lg:border-purple-200 dark:lg:border-purple-800 lg:pl-4">
                  <span className="text-xs text-muted-foreground font-medium">Your Role:</span>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
                      selectedToken.isOwner 
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white ring-2 ring-green-200 dark:ring-green-800' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      <Shield className="w-3 h-3" />
                      {selectedToken.isOwner ? 'Owner' : 'Not Owner'}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
                      selectedToken.isAuditor 
                        ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white ring-2 ring-purple-200 dark:ring-purple-800' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      <Users className="w-3 h-3" />
                      {selectedToken.isAuditor ? 'Auditor' : 'Not Auditor'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoadingTokens && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading contracts...</p>
          </div>
        )}

        {/* No Contracts */}
        {!isLoadingTokens && tokens.length === 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-6 border border-amber-200 dark:border-amber-800 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              No contracts found. Please check configuration.
            </p>
          </div>
        )}

        {/* Main Content */}
        {selectedToken && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Left Sidebar - Token Info */}
            <div className="lg:col-span-1">
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800 sticky top-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Coins className="w-4 h-4" />
                  Token Info
                </h2>
                <div className="space-y-2.5">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-mono text-sm font-semibold">{selectedToken.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Symbol</p>
                    <p className="font-mono text-sm font-semibold">{selectedToken.symbol}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Decimals</p>
                    <p className="font-mono text-sm font-semibold">{selectedToken.decimals}</p>
                  </div>
                  <div className="pt-2 border-t border-purple-200 dark:border-purple-800">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs text-muted-foreground">
                        Total Supply {!decryptedSupply && <span className="text-muted-foreground/70">(Encrypted)</span>}
                      </p>
                      {!decryptedSupply && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleDecryptSupply}
                          disabled={isDecryptingSupply}
                          className="h-5 px-1.5 text-xs -mt-1"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          {isDecryptingSupply ? 'Decrypting...' : 'Decrypt'}
                        </Button>
                      )}
                    </div>
                    {decryptedSupply ? (
                      <p className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">
                        {decryptedSupply}
                      </p>
                    ) : (
                      <p className="font-mono text-xs break-all text-muted-foreground" title={selectedToken.totalSupply}>
                        {selectedToken.totalSupply.substring(0, 8)}...{selectedToken.totalSupply.substring(selectedToken.totalSupply.length - 4)}
                      </p>
                    )}
                  </div>
                  <div className="pt-2 border-t border-purple-200 dark:border-purple-800">
                    <p className="text-xs text-muted-foreground mb-1">Contract</p>
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-xs break-all flex-1">{selectedToken.address.substring(0, 10)}...{selectedToken.address.substring(selectedToken.address.length - 8)}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(selectedToken.address, 'contract')}
                        className="h-6 w-6 p-0 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                        title="Copy contract address"
                      >
                        {copiedAddress === 'contract' ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Owner</p>
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-xs break-all flex-1">{selectedToken.owner.substring(0, 10)}...{selectedToken.owner.substring(selectedToken.owner.length - 8)}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(selectedToken.owner, 'owner')}
                        className="h-6 w-6 p-0 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                        title="Copy owner address"
                      >
                        {copiedAddress === 'owner' ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Content - Actions */}
            <div className="lg:col-span-3 space-y-4">
              {/* Token Operations Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Mint Card */}
                <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-green-600 dark:text-green-400" />
                    Mint Tokens
                  </h3>
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Recipient</label>
                      <input
                        type="text"
                        placeholder="0x..."
                        value={mintTo}
                        onChange={(e) => setMintTo(e.target.value)}
                        disabled={!selectedToken.isOwner || isMinting}
                        className="w-full p-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-1 focus:ring-green-500 focus:border-transparent disabled:opacity-50 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Amount</label>
                      <input
                        type="text"
                        placeholder="1000"
                        value={mintAmount}
                        onChange={(e) => setMintAmount(e.target.value)}
                        disabled={!selectedToken.isOwner || isMinting}
                        className="w-full p-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-1 focus:ring-green-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                    <Button
                      onClick={handleMint}
                      disabled={!selectedToken.isOwner || isMinting || !mintTo || !mintAmount}
                      className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 h-8 text-xs"
                    >
                      {isMinting ? (
                        <><RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />Minting...</>
                      ) : (
                        <><Coins className="w-3 h-3 mr-1.5" />Mint</>
                      )}
                    </Button>
                    {!selectedToken.isOwner && account && (
                      <p className="text-xs text-amber-600">⚠️ Owner only</p>
                    )}
                  </div>
                </div>

                {/* Burn Card */}
                <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Flame className="w-4 h-4 text-red-600 dark:text-red-400" />
                    Burn Tokens
                  </h3>
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Amount</label>
                      <input
                        type="text"
                        placeholder="500"
                        value={burnAmount}
                        onChange={(e) => setBurnAmount(e.target.value)}
                        disabled={!account || isBurning}
                        className="w-full p-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-1 focus:ring-red-500 focus:border-transparent disabled:opacity-50"
                      />
                      <p className="text-xs text-muted-foreground mt-1">From your balance</p>
                    </div>
                    <Button
                      onClick={handleBurn}
                      disabled={!account || isBurning || !burnAmount}
                      className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 h-8 text-xs mt-[44px]"
                    >
                      {isBurning ? (
                        <><RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />Burning...</>
                      ) : (
                        <><Flame className="w-3 h-3 mr-1.5" />Burn</>
                      )}
                    </Button>
                    {!account && (
                      <p className="text-xs text-amber-600">⚠️ Connect wallet</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Auditor Management */}
              <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Grant Auditor Role
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Auditors can view encrypted balances via <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">balanceOfForCaller()</code>
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="0x..."
                    value={grantRoleAddress}
                    onChange={(e) => setGrantRoleAddress(e.target.value)}
                    disabled={!selectedToken.isOwner || isGranting}
                    className="flex-1 p-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-1 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 font-mono"
                  />
                  <Button
                    onClick={handleGrantRole}
                    disabled={!selectedToken.isOwner || isGranting || !grantRoleAddress}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 h-9 text-xs px-4"
                  >
                    {isGranting ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Granting...</>
                    ) : (
                      <><UserPlus className="w-3.5 h-3.5 mr-1" />Grant</>
                    )}
                  </Button>
                </div>
                {!selectedToken.isOwner && account && (
                  <p className="text-xs text-amber-600 mt-2">⚠️ Owner only</p>
                )}
              </div>

              {/* Auditors List */}
              <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                {!account ? (
                  <>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Current Auditors
                    </h3>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-muted-foreground">
                        Connect wallet to view auditors
                      </p>
                    </div>
                  </>
                ) : !selectedToken.isOwner ? (
                  <>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Current Auditors
                    </h3>
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5" />
                        Owner only
                      </p>
                    </div>
                  </>
                ) : selectedToken.totalAuditors === 0 ? (
                  <>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Current Auditors (0)
                    </h3>
                    <p className="text-xs text-muted-foreground">No auditors granted yet.</p>
                  </>
                ) : (
                  <>
                    {/* Header with pagination */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <h3 className="text-sm font-semibold">Auditors</h3>
                        <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 rounded-full text-xs font-medium">
                          {selectedToken.totalAuditors}
                        </span>
                      </div>
                      
                      {/* Pagination */}
                      {(() => {
                        const totalPages = Math.ceil(selectedToken.totalAuditors / auditorsPerPage);
                        return totalPages > 1 && (
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setCurrentAuditorPage(p => Math.max(1, p - 1))} disabled={currentAuditorPage === 1} className="h-7 w-7 p-0 text-xs">
                              ←
                            </Button>
                            <span className="text-xs font-medium">
                              {currentAuditorPage}/{totalPages}
                            </span>
                            <Button variant="outline" size="sm" onClick={() => setCurrentAuditorPage(p => Math.min(totalPages, p + 1))} disabled={currentAuditorPage >= totalPages} className="h-7 w-7 p-0 text-xs">
                              →
                            </Button>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Auditors List */}
                    <div className="space-y-1.5">
                      {selectedToken.auditors.map((auditorAddr: string, index: number) => {
                        const globalIndex = (currentAuditorPage - 1) * auditorsPerPage + index + 1;
                        return (
                          <div
                            key={auditorAddr}
                            className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground w-6">#{globalIndex}</span>
                              <span className="font-mono text-xs">{auditorAddr.substring(0, 10)}...{auditorAddr.substring(auditorAddr.length - 8)}</span>
                              {account?.toLowerCase() === auditorAddr.toLowerCase() && (
                                <span className="px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                                  You
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeRole(auditorAddr)}
                              disabled={isRevoking}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 h-7 text-xs px-2"
                            >
                              {isRevoking ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <><UserMinus className="w-3 h-3 mr-1" />Revoke</>
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`p-3 rounded-md text-sm ${
            feedback.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              : feedback.type === 'success'
              ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
          }`}>
            {feedback.msg}
          </div>
        )}

        {/* Status Bar */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800 text-sm text-muted-foreground flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${status ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
          Status: <span className="font-medium">{status || "Ready"}</span>
        </div>
      </div>
    </Main>
  );
};
