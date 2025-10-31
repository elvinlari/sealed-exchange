"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWalletStore } from '@/stores/wallet-store';
import { useVaultContext } from '@/hooks/useVaultContext';
import { Coins, Eye, RefreshCw, Lock, CheckCircle, ChevronLeft, ChevronRight, AlertCircle, ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react';
import { decryptValue } from '@/lib/fhevm-decrypt';
import { getTokenMaxDecimalsForAddress, stepFromDecimals, formatAmountLocale } from '@/lib/token-decimals';

const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

type AssetBalance = {
  assetId: string;
  token: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  enabled: boolean;
  paused: boolean;
  isNumeraire: boolean;
  encryptedAvailable: string;
  encryptedReserved: string;
  decryptedAvailable: string | null;
  decryptedReserved: string | null;
  isDecryptingAvailable: boolean;
  isDecryptingReserved: boolean;
  error?: string | null;
};

export function Vault() {
  const { provider, signer, account } = useWalletStore();
  const { vaultInfo, vaultAddress, vaultAbi, depositToVault, withdrawFromVault, fetchVaultBalances, error: vaultError, setError: setVaultError } = useVaultContext();
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(5);

  // Deposit/Withdraw dialogs
  const [depositDialogOpen, setDepositDialogOpen] = useState<boolean>(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetBalance | null>(null);
  const [transactionAmount, setTransactionAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Load assets with balances
  const loadAssetBalances = async () => {
    if (!provider || !signer || !account || !vaultInfo) return;

    setIsLoading(true);
    setError(null);

    try {
      const vaultContract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      const totalAssets = vaultInfo.totalAssets;

      if (totalAssets === 0) {
        setAssets([]);
        setIsLoading(false);
        return;
      }

      // Fetch all assets in batches
      const batchSize = 10;
      const allAssets: AssetBalance[] = [];

      for (let offset = 0; offset < totalAssets; offset += batchSize) {
        const limit = Math.min(batchSize, totalAssets - offset);
        
        const result = await vaultContract.listAssets(offset, limit);
        const [ids, tokens, enabled, paused, isNumeraire] = result;

        // For each asset, get balances and token info
        const assetPromises = ids.map(async (assetId: string, index: number) => {
          try {
            const tokenAddress = tokens[index];
            
            // Get token info
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);
            const [name, symbol, decimals] = await Promise.all([
              tokenContract.name(),
              tokenContract.symbol(),
              tokenContract.decimals(),
            ]);

            // Get balances from vault using context function
            let encryptedAvailable = "0x";
            let encryptedReserved = "0x";
            
            try {
              const balances = await fetchVaultBalances(assetId);
              encryptedAvailable = balances.availableCiphertext || "0x";
              encryptedReserved = balances.reservedCiphertext || "0x";
              console.log(`Balances for ${symbol}:`, {
                assetId,
                available: encryptedAvailable,
                reserved: encryptedReserved
              });
            } catch (balanceErr) {
              console.error(`Error fetching balances for ${symbol}:`, balanceErr);
            }

            return {
              assetId,
              token: tokenAddress,
              tokenName: name,
              tokenSymbol: symbol,
              decimals: Number(decimals),
              enabled: enabled[index],
              paused: paused[index],
              isNumeraire: isNumeraire[index],
              encryptedAvailable,
              encryptedReserved,
              decryptedAvailable: null,
              decryptedReserved: null,
              isDecryptingAvailable: false,
              isDecryptingReserved: false,
              error: null,
            };
          } catch (err: any) {
            console.error(`Error loading asset ${assetId}:`, err);
            return {
              assetId,
              token: tokens[index] || "0x",
              tokenName: "Unknown",
              tokenSymbol: "???",
              decimals: 18,
              enabled: false,
              paused: true,
              isNumeraire: false,
              encryptedAvailable: "0x",
              encryptedReserved: "0x",
              decryptedAvailable: null,
              decryptedReserved: null,
              isDecryptingAvailable: false,
              isDecryptingReserved: false,
              error: err.message || "Failed to load",
            };
          }
        });

        const batchAssets = await Promise.all(assetPromises);
        allAssets.push(...batchAssets);
      }

      setAssets(allAssets);
    } catch (err: any) {
      console.error("Error loading asset balances:", err);
      setError({
        title: "Failed to Load Balances",
        description: err.message || "Could not load vault balances"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Decrypt available balance
  const decryptAvailableBalance = async (assetId: string) => {
    if (!provider || !signer || !account) return;

    const asset = assets.find(a => a.assetId === assetId);
    if (!asset || !asset.encryptedAvailable || asset.encryptedAvailable === "0x") {
      console.log(`Cannot decrypt - no encrypted balance for ${asset?.tokenSymbol}`);
      return;
    }

    // Check if handle is all zeros (encrypted zero value)
    const isZeroHandle = asset.encryptedAvailable.replace(/^0x/, '').replace(/0/g, '') === '';
    if (isZeroHandle) {
      console.log(`Handle is zero for ${asset.tokenSymbol}, setting balance to 0`);
      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, decryptedAvailable: '0', isDecryptingAvailable: false } 
          : a
      ));
      return;
    }

    setAssets(prev => prev.map(a => 
      a.assetId === assetId ? { ...a, isDecryptingAvailable: true, error: null } : a
    ));

    try {
      console.log(`Decrypting available balance for ${asset.tokenSymbol}:`, {
        handle: asset.encryptedAvailable,
        vaultAddress,
        decimals: asset.decimals
      });

      const value = await decryptValue(
        asset.encryptedAvailable,
        vaultAddress,
        asset.decimals,
        provider,
        signer
      );

      console.log(`Decrypted available balance for ${asset.tokenSymbol}:`, value);

      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, decryptedAvailable: value || '0', isDecryptingAvailable: false } 
          : a
      ));
    } catch (err: any) {
      console.error(`Error decrypting available balance for ${asset.tokenSymbol}:`, err);
      const errorMsg = err?.message || err?.shortMessage || 'Decryption failed';
      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, isDecryptingAvailable: false, error: errorMsg } 
          : a
      ));
    }
  };

  // Decrypt reserved balance
  const decryptReservedBalance = async (assetId: string) => {
    if (!provider || !signer || !account) return;

    const asset = assets.find(a => a.assetId === assetId);
    if (!asset || !asset.encryptedReserved || asset.encryptedReserved === "0x") {
      console.log(`Cannot decrypt - no encrypted reserved balance for ${asset?.tokenSymbol}`);
      return;
    }

    // Check if handle is all zeros (encrypted zero value)
    const isZeroHandle = asset.encryptedReserved.replace(/^0x/, '').replace(/0/g, '') === '';
    if (isZeroHandle) {
      console.log(`Reserved handle is zero for ${asset.tokenSymbol}, setting balance to 0`);
      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, decryptedReserved: '0', isDecryptingReserved: false } 
          : a
      ));
      return;
    }

    setAssets(prev => prev.map(a => 
      a.assetId === assetId ? { ...a, isDecryptingReserved: true, error: null } : a
    ));

    try {
      console.log(`Decrypting reserved balance for ${asset.tokenSymbol}:`, {
        handle: asset.encryptedReserved,
        vaultAddress,
        decimals: asset.decimals
      });

      const value = await decryptValue(
        asset.encryptedReserved,
        vaultAddress,
        asset.decimals,
        provider,
        signer
      );

      console.log(`Decrypted reserved balance for ${asset.tokenSymbol}:`, value);

      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, decryptedReserved: value || '0', isDecryptingReserved: false } 
          : a
      ));
    } catch (err: any) {
      console.error(`Error decrypting reserved balance for ${asset.tokenSymbol}:`, err);
      const errorMsg = err?.message || err?.shortMessage || 'Decryption failed';
      setAssets(prev => prev.map(a => 
        a.assetId === assetId 
          ? { ...a, isDecryptingReserved: false, error: errorMsg } 
          : a
      ));
    }
  };

  // Decrypt all balances
  const decryptAllBalances = async () => {
    for (const asset of assets) {
      if (asset.encryptedAvailable && asset.encryptedAvailable !== "0x") {
        await decryptAvailableBalance(asset.assetId);
      }
      if (asset.encryptedReserved && asset.encryptedReserved !== "0x") {
        await decryptReservedBalance(asset.assetId);
      }
    }
  };

  // Load balances on mount
  useEffect(() => {
    if (account && vaultInfo) {
      loadAssetBalances();
    }
  }, [account, vaultInfo]);

  // Reset to page 1 when assets change
  useEffect(() => {
    setCurrentPage(1);
  }, [assets.length]);

  // Update selectedAsset when assets change (e.g., after decryption)
  useEffect(() => {
    if (selectedAsset) {
      const updatedAsset = assets.find(a => a.assetId === selectedAsset.assetId);
      if (updatedAsset) {
        setSelectedAsset(updatedAsset);
      }
    }
  }, [assets]);

  // Calculate pagination
  const totalPages = Math.ceil(assets.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedAssets = assets.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  // Open deposit dialog
  const openDepositDialog = (asset: AssetBalance) => {
    // Find the latest version of this asset from state to get any decrypted values
    const latestAsset = assets.find(a => a.assetId === asset.assetId) || asset;
    setSelectedAsset(latestAsset);
    setTransactionAmount("");
    setError(null);
    setVaultError(null);
    setDepositDialogOpen(true);
  };

  // Open withdraw dialog
  const openWithdrawDialog = (asset: AssetBalance) => {
    // Find the latest version of this asset from state to get any decrypted values
    const latestAsset = assets.find(a => a.assetId === asset.assetId) || asset;
    setSelectedAsset(latestAsset);
    setTransactionAmount("");
    setError(null);
    setVaultError(null);
    setWithdrawDialogOpen(true);
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!selectedAsset) return;

    if (!transactionAmount || parseFloat(transactionAmount) <= 0) {
      setError({
        title: "Invalid Amount",
        description: "Please enter a valid amount"
      });
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      await depositToVault(
        selectedAsset.assetId,
        selectedAsset.token,
        transactionAmount,
        selectedAsset.decimals
      );

      // Refresh balances
      await loadAssetBalances();

      // Close dialog and reset
      setDepositDialogOpen(false);
      setTransactionAmount("");
      setSelectedAsset(null);
      setError(null);
      setVaultError(null);
    } catch (err: any) {
      console.error("Deposit error:", err);
      console.log("Error state:", error);
      console.log("Vault error state:", vaultError);
      console.log("Selected asset:", selectedAsset);
      // Error is already set by depositToVault via context
      // Close dialog but keep selectedAsset to show error on card
      // Use setTimeout to ensure error state is set before closing dialog
      setTimeout(() => {
        setDepositDialogOpen(false);
      }, 100);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!selectedAsset) return;

    if (!transactionAmount || parseFloat(transactionAmount) <= 0) {
      setError({
        title: "Invalid Amount",
        description: "Please enter a valid amount"
      });
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      await withdrawFromVault(
        selectedAsset.assetId,
        selectedAsset.token,
        transactionAmount,
        selectedAsset.decimals
      );

      // Refresh balances
      await loadAssetBalances();

      // Close dialog and reset
      setWithdrawDialogOpen(false);
      setTransactionAmount("");
      setSelectedAsset(null);
      setError(null);
      setVaultError(null);
    } catch (err: any) {
      console.error("Withdrawal error:", err);
      console.log("Error state:", error);
      console.log("Vault error state:", vaultError);
      console.log("Selected asset:", selectedAsset);
      // Error is already set by withdrawFromVault via context
      // Close dialog but keep selectedAsset to show error on card
      // Use setTimeout to ensure error state is set before closing dialog
      setTimeout(() => {
        setWithdrawDialogOpen(false);
      }, 100);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Coins className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              Vault Balances
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              View your available and reserved balances in the vault
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={loadAssetBalances}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={decryptAllBalances}
              disabled={isLoading || assets.length === 0}
              size="sm"
              className="cursor-pointer"
            >
              <Eye className="h-4 w-4 mr-2" />
              Decrypt All
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h3 className="font-semibold text-sm">Total Assets</h3>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {vaultInfo?.totalAssets || 0}
            </p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-3 mb-2">
              <Coins className="h-5 w-5 text-green-600 dark:text-green-400" />
              <h3 className="font-semibold text-sm">Available Balances</h3>
            </div>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              {assets.filter(a => a.decryptedAvailable !== null).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Decrypted</p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-3 mb-2">
              <Lock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <h3 className="font-semibold text-sm">Reserved Balances</h3>
            </div>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {assets.filter(a => a.decryptedReserved !== null).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Decrypted</p>
          </div>
        </div>

        {/* Assets List */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          {isLoading && assets.length === 0 ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading vault balances...</p>
            </div>
          ) : assets.length === 0 ? (
            <div className="p-12 text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-muted-foreground">No assets found in vault</p>
            </div>
          ) : (
            <>
              {/* Assets Table */}
              <div className="overflow-x-auto">
                <div className="space-y-3 p-4">
                  {paginatedAssets.map((asset) => (
                    <div
                      key={asset.assetId}
                      className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow"
                    >
                      {/* Asset Header */}
                      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                            {asset.tokenSymbol.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-semibold text-lg">{asset.tokenName}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              {asset.tokenSymbol}
                              <span className="text-xs">•</span>
                              <code className="text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                                {asset.token.substring(0, 6)}...{asset.token.substring(38)}
                              </code>
                            </div>
                          </div>
                        </div>
                        
                        {/* Status Badges */}
                        <div className="flex items-center gap-2">
                          {asset.isNumeraire && (
                            <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs rounded-md font-medium">
                              Numeraire
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                            asset.enabled && !asset.paused
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          }`}>
                            {asset.enabled && !asset.paused ? 'Active' : asset.paused ? 'Paused' : 'Disabled'}
                          </span>
                        </div>
                      </div>

                      {/* Balances Grid */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Available Balance */}
                        <div className="bg-white dark:bg-gray-950 rounded-lg p-4 border border-green-200 dark:border-green-800">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                              <h4 className="font-semibold text-sm">Available Balance</h4>
                            </div>
                            {!asset.decryptedAvailable && (
                              <Button
                                onClick={() => decryptAvailableBalance(asset.assetId)}
                                disabled={asset.isDecryptingAvailable || !asset.encryptedAvailable || asset.encryptedAvailable === "0x"}
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 cursor-pointer"
                              >
                                {asset.isDecryptingAvailable ? (
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-600"></div>
                                ) : (
                                  <><Eye className="h-3 w-3 mr-1" />Decrypt</>
                                )}
                              </Button>
                            )}
                          </div>

                          {asset.isDecryptingAvailable ? (
                            <div className="text-sm text-muted-foreground">Decrypting...</div>
                          ) : asset.decryptedAvailable !== null ? (
                            <div>
                              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                                {formatAmountLocale(
                                  asset.decryptedAvailable,
                                  getTokenMaxDecimalsForAddress(asset.token, asset.decimals)
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{asset.tokenSymbol}</div>
                            </div>
                          ) : (
                            <div>
                              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded block break-all">
                                {asset.encryptedAvailable === "0x" 
                                  ? "—" 
                                  : `${asset.encryptedAvailable.substring(0, 10)}...`}
                              </code>
                              <div className="text-xs text-muted-foreground mt-1">Encrypted</div>
                            </div>
                          )}
                        </div>

                        {/* Reserved Balance */}
                        <div className="bg-white dark:bg-gray-950 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                              <h4 className="font-semibold text-sm">Reserved Balance</h4>
                            </div>
                            {!asset.decryptedReserved && (
                              <Button
                                onClick={() => decryptReservedBalance(asset.assetId)}
                                disabled={asset.isDecryptingReserved || !asset.encryptedReserved || asset.encryptedReserved === "0x"}
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 cursor-pointer"
                              >
                                {asset.isDecryptingReserved ? (
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-purple-600"></div>
                                ) : (
                                  <><Eye className="h-3 w-3 mr-1" />Decrypt</>
                                )}
                              </Button>
                            )}
                          </div>

                          {asset.isDecryptingReserved ? (
                            <div className="text-sm text-muted-foreground">Decrypting...</div>
                          ) : asset.decryptedReserved !== null ? (
                            <div>
                              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                {formatAmountLocale(
                                  asset.decryptedReserved,
                                  getTokenMaxDecimalsForAddress(asset.token, asset.decimals)
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{asset.tokenSymbol}</div>
                            </div>
                          ) : (
                            <div>
                              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded block break-all">
                                {asset.encryptedReserved === "0x" 
                                  ? "—" 
                                  : `${asset.encryptedReserved.substring(0, 10)}...`}
                              </code>
                              <div className="text-xs text-muted-foreground mt-1">Encrypted</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2">
                        <Button
                          onClick={() => openDepositDialog(asset)}
                          disabled={!asset.enabled || asset.paused}
                          size="sm"
                          className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 cursor-pointer"
                        >
                          <ArrowDownToLine className="h-4 w-4 mr-1.5" />
                          Deposit
                        </Button>
                        <Button
                          onClick={() => openWithdrawDialog(asset)}
                          disabled={!asset.enabled || asset.paused}
                          size="sm"
                          className="flex-1 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white cursor-pointer"
                        >
                          <ArrowUpFromLine className="h-4 w-4 mr-1.5" />
                          Withdraw
                        </Button>
                      </div>

                      {/* Transaction Error Display */}
                      {((error && selectedAsset?.assetId === asset.assetId) || (vaultError && selectedAsset?.assetId === asset.assetId)) && (
                        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <h4 className="text-sm font-semibold text-red-900 dark:text-red-100">
                                {error?.title || vaultError?.title}
                              </h4>
                              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                                {error?.description || vaultError?.description}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setError(null);
                                setVaultError(null);
                                setSelectedAsset(null);
                              }}
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 flex-shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Decrypt Error Display */}
                      {asset.error && (
                        <div className="mt-3 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
                          {asset.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Pagination Footer */}
              {assets.length > 0 && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1}-{Math.min(endIndex, assets.length)} of {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Items per page */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Items per page:</span>
                        <select
                          value={itemsPerPage}
                          onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                          className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-900 cursor-pointer"
                        >
                          <option value={2}>2</option>
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                        </select>
                      </div>

                      {/* Page navigation */}
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>

                        <span className="text-sm text-muted-foreground">
                          Page {currentPage} of {totalPages}
                        </span>

                        <Button
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === totalPages}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            💡 <strong>Privacy Note:</strong> Your vault balances are encrypted on-chain. Available balance is ready for use, while reserved balance is locked in active orders or positions. Click "Decrypt" to view actual amounts.
          </p>
        </div>

        {/* Deposit Dialog */}
        <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>
                Deposit {selectedAsset?.tokenSymbol}
              </DialogTitle>
              <DialogDescription>
                Deposit {selectedAsset?.tokenName} tokens into the vault
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="deposit-amount">Amount</Label>
                <Input
                  id="deposit-amount"
                  type="number"
                  placeholder="0.0"
                  value={transactionAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTransactionAmount(e.target.value)}
                  disabled={isProcessing}
                  step={selectedAsset ? stepFromDecimals(getTokenMaxDecimalsForAddress(selectedAsset.token, selectedAsset.decimals)) : 'any'}
                />
                {selectedAsset && (
                  <p className="text-xs text-muted-foreground">
                    Asset: {selectedAsset.tokenName} ({selectedAsset.tokenSymbol})
                  </p>
                )}
              </div>

              {selectedAsset && selectedAsset.decryptedAvailable && (
                <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Your current vault balance: {formatAmountLocale(
                      selectedAsset.decryptedAvailable,
                      getTokenMaxDecimalsForAddress(selectedAsset.token, selectedAsset.decimals)
                    )} {selectedAsset.tokenSymbol}
                  </p>
                </div>
              )}

              <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  ⚠️ Note: Depositing will transfer tokens from your wallet to the vault. Make sure you have sufficient balance in your wallet.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setDepositDialogOpen(false);
                  setTransactionAmount("");
                  setError(null);
                  setVaultError(null);
                }}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeposit}
                disabled={isProcessing || !transactionAmount}
                className="cursor-pointer bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Depositing...
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                    Deposit
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Withdraw Dialog */}
        <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>
                Withdraw {selectedAsset?.tokenSymbol}
              </DialogTitle>
              <DialogDescription>
                Withdraw {selectedAsset?.tokenName} tokens from the vault
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="withdraw-amount">Amount</Label>
                <Input
                  id="withdraw-amount"
                  type="number"
                  placeholder="0.0"
                  value={transactionAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTransactionAmount(e.target.value)}
                  disabled={isProcessing}
                  step={selectedAsset ? stepFromDecimals(getTokenMaxDecimalsForAddress(selectedAsset.token, selectedAsset.decimals)) : 'any'}
                />
                {selectedAsset && (
                  <p className="text-xs text-muted-foreground">
                    Asset: {selectedAsset.tokenName} ({selectedAsset.tokenSymbol})
                  </p>
                )}
              </div>

              {selectedAsset && selectedAsset.decryptedAvailable && (
                <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Available to withdraw: {formatAmountLocale(
                      selectedAsset.decryptedAvailable,
                      getTokenMaxDecimalsForAddress(selectedAsset.token, selectedAsset.decimals)
                    )} {selectedAsset.tokenSymbol}
                  </p>
                </div>
              )}

              {selectedAsset && !selectedAsset.decryptedAvailable && (
                <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 flex-1">
                      ⚠️ Decrypt your available balance to see how much you can withdraw
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (selectedAsset) {
                          await decryptAvailableBalance(selectedAsset.assetId);
                        }
                      }}
                      disabled={selectedAsset.isDecryptingAvailable}
                      className="cursor-pointer shrink-0"
                    >
                      {selectedAsset.isDecryptingAvailable ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-700 mr-1"></div>
                          Decrypting...
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3 mr-1" />
                          Decrypt
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setWithdrawDialogOpen(false);
                  setTransactionAmount("");
                  setError(null);
                  setVaultError(null);
                }}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleWithdraw}
                disabled={isProcessing || !transactionAmount}
                className="cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Withdrawing...
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="h-4 w-4 mr-2" />
                    Withdraw
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
