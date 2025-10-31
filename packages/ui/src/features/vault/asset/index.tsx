"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Button } from '@/components/ui/button';
import { useWalletStore } from '@/stores/wallet-store';
import { Plus, Package, Copy, Check } from 'lucide-react';
import { useVaultContext } from '@/hooks/useVaultContext';

// Predefined token addresses sourced from environment variables
const envTokenCUSDT = import.meta.env.VITE_TOKEN_CUSDT_ADDRESS as string | undefined;
const envTokenCBTC  = import.meta.env.VITE_TOKEN_CBTC_ADDRESS as string | undefined;
const envTokenCETH  = import.meta.env.VITE_TOKEN_CETH_ADDRESS as string | undefined;
const envTokenCGOLD = import.meta.env.VITE_TOKEN_CGOLD_ADDRESS as string | undefined;

export const TOKEN_ADDRESS_BOOK: { name: string; address: string }[] = [
  ...(envTokenCUSDT ? [{ name: 'cUSDT', address: envTokenCUSDT }] : []),
  ...(envTokenCBTC  ? [{ name: 'cBTC',  address: envTokenCBTC  }] : []),
  ...(envTokenCETH  ? [{ name: 'cETH',  address: envTokenCETH  }] : []),
  ...(envTokenCGOLD ? [{ name: 'cXAU', address: envTokenCGOLD }] : []),
];

export function VaultAssets() {
  const { provider, signer } = useWalletStore();
  const { vaultInfo, setVaultInfo, loadVaultInfo, vaultAddress, vaultAbi, setStatus, setError } = useVaultContext();

  // Form states - Asset registration
  const [assetToken, setAssetToken] = useState<string>("");
  const [tokenName, setTokenName] = useState<string>("");
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  const [isFetchingToken, setIsFetchingToken] = useState<boolean>(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  // UI states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [updatingAssetId, setUpdatingAssetId] = useState<string | null>(null);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Copy to clipboard handler
  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Load assets page when currentPage changes
  useEffect(() => {
    if (provider && vaultInfo) {
      loadAssets(currentPage);
    }
  }, [currentPage, provider, vaultInfo?.totalAssets]);

  // Load paginated assets
  const loadAssets = async (page: number) => {
    if (!provider) return;
    
    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, provider);
      const offset = (page - 1) * itemsPerPage;
      const assetData = await contract.listAssets(offset, itemsPerPage);
      
      // Fetch token details for each asset
      const tokenAbi = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
      ];
      
      const assetsWithDetails = await Promise.all(
        assetData.ids.map(async (id: string, index: number) => {
          const tokenAddress = assetData.tokens[index];
          let tokenName = "Unknown";
          let tokenSymbol = "???";
          
          try {
            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, provider);
            const [name, symbol] = await Promise.all([
              tokenContract.name(),
              tokenContract.symbol(),
            ]);
            tokenName = name;
            tokenSymbol = symbol;
          } catch (err) {
            console.error(`Failed to fetch token details for ${tokenAddress}:`, err);
          }
          
          return {
            id,
            token: tokenAddress,
            tokenName,
            tokenSymbol,
            enabled: assetData.enabled[index],
            paused: assetData.paused[index],
            isNumeraire: assetData.isNumeraire[index],
          };
        })
      );
      
      setVaultInfo(prev => prev ? { ...prev, assets: assetsWithDetails } : null);
    } catch (err) {
      console.error("Failed to load assets:", err);
    }
  };

  const fetchTokenDetails = async () => {
    if (!provider || !assetToken.trim()) {
      setError({ title: "Invalid Input", description: "Please provide a token address" });
      return;
    }

    // Validate address format
    if (!ethers.isAddress(assetToken)) {
      setError({ title: "Invalid Address", description: "Please provide a valid Ethereum address" });
      return;
    }

    setIsFetchingToken(true);
    setError(null);
    setTokenName("");
    setTokenSymbol("");

    try {
      const tokenAbi = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
      ];
      
      const tokenContract = new ethers.Contract(assetToken, tokenAbi, provider);
      
      const [name, symbol] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
      ]);

      setTokenName(name);
      setTokenSymbol(symbol);
      setStatus(`Token found: ${name} (${symbol})`);
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      console.error("Error fetching token details:", err);
      setError({
        title: "Token Not Found",
        description: "Could not fetch token details. Please verify the address is a valid ERC20 token."
      });
      setTokenName("");
      setTokenSymbol("");
    } finally {
      setIsFetchingToken(false);
    }
  };

  const registerAsset = async () => {
    if (!signer || !vaultInfo?.isAdmin) return;
    if (!assetToken.trim() || !tokenSymbol.trim()) {
      setError({ title: "Invalid Input", description: "Please fetch token details first" });
      return;
    }

    setIsLoading(true);
    setStatus('Registering asset...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      // Use keccak256 of the token symbol as asset ID (e.g., "cUSDC")
      const assetIdBytes32 = ethers.id(tokenSymbol);
      
      // Always register as numeraire (quote currency) by default
      const tx = await contract.registerAsset(assetIdBytes32, assetToken, true);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus(`Asset registered successfully: ${tokenSymbol}`);
      
      // Clear form
      setAssetToken("");
      setTokenName("");
      setTokenSymbol("");
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error registering asset:", err);
      setError({
        title: "Registration Failed",
        description: err.message || "Could not register asset"
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const updateAssetStatus = async (assetId: string, enabled: boolean, paused: boolean) => {
    if (!signer || !vaultInfo?.isAdmin) return;

    setUpdatingAssetId(assetId);
    setStatus('Updating asset status...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      const tx = await contract.setAssetStatus(assetId, enabled, paused);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus('Asset status updated successfully!');
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error updating asset status:", err);
      setError({
        title: "Update Failed",
        description: err.message || "Could not update asset status"
      });
    } finally {
      setUpdatingAssetId(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div className="w-full">
      {/* Asset Management - Admin Only */}
      {vaultInfo?.isAdmin && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-semibold">Register Asset</h2>
          </div>
          
          <div className="space-y-4">
            {/* Token Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Select Token</label>
              {TOKEN_ADDRESS_BOOK.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    value={assetToken}
                    onChange={(e) => setAssetToken(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                  >
                    <option value="" disabled>
                      Select a token…
                    </option>
                    {TOKEN_ADDRESS_BOOK.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.name} — {t.address}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={fetchTokenDetails}
                    disabled={isFetchingToken || !assetToken.trim()}
                    type="button"
                    className="cursor-pointer"
                  >
                    {isFetchingToken ? 'Fetching...' : 'Fetch Details'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No predefined tokens configured. Set VITE_TOKEN_CUSDT_ADDRESS and VITE_TOKEN_CBTC_ADDRESS in your .env.
                </p>
              )}
            </div>

            {/* Token Details Display */}
          {tokenName && tokenSymbol && (
            <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-md">
              <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-2">Token Found:</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-semibold">{tokenName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Symbol</p>
                  <p className="font-semibold">{tokenSymbol}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Asset ID will be: <span className="font-mono font-semibold">{tokenSymbol}</span> (keccak256)
              </p>
            </div>
          )}
        </div>

        <Button
          onClick={registerAsset}
          disabled={isLoading || !tokenSymbol.trim() || !assetToken.trim()}
          className="w-full mt-4 cursor-pointer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Register Asset
        </Button>
        </div>
      )}

      {/* Registered Assets List - Public View */}
      {vaultInfo && vaultInfo.totalAssets > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          {(() => {
            const totalPages = Math.ceil(vaultInfo.totalAssets / itemsPerPage);

            return (
              <>
                {/* Header with pagination controls */}
                <div className="flex items-center justify-between mb-4 gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="font-semibold">Registered Assets</h3>
                    <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 rounded-full text-sm font-medium">
                      {vaultInfo.totalAssets} {vaultInfo.totalAssets === 1 ? 'asset' : 'assets'}
                    </span>
                  </div>

                  {/* Pagination Controls */}
                  <div className="flex items-center gap-3">
                    <select 
                      className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
                      value={itemsPerPage}
                      onChange={() => {
                        setCurrentPage(1);
                      }}
                    >
                      <option value={5}>5 / page</option>
                    </select>
                    
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setCurrentPage(1)} 
                      disabled={currentPage === 1}
                      className="px-3 cursor-pointer"
                    >
                      {"⏮"}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                      disabled={currentPage === 1}
                      className="px-3 cursor-pointer"
                    >
                      {"◀"}
                      </Button>
                      <span className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-medium">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                        disabled={currentPage >= totalPages}
                        className="px-3 cursor-pointer"
                      >
                        {"▶"}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setCurrentPage(totalPages)} 
                        disabled={currentPage >= totalPages}
                        className="px-3 cursor-pointer"
                      >
                        {"⏭"}
                      </Button>
                    </div>
                  </div>

                  {/* Assets List */}
                  <div className="divide-y divide-gray-200 dark:divide-gray-800 overflow-y-auto max-h-[70vh] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                    {vaultInfo.assets.map((asset, index) => (
                      <div
                        key={index}
                        className="p-4 hover:bg-gradient-to-r hover:from-purple-50 hover:to-blue-50 dark:hover:from-purple-950/10 dark:hover:to-blue-950/10 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          {/* Left Section - Token Info & Details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-base font-semibold bg-gradient-to-r from-purple-600 to-blue-600 dark:from-purple-400 dark:to-blue-400 bg-clip-text text-transparent">
                                {asset.tokenName} ({asset.tokenSymbol})
                              </h3>
                              <div className="flex gap-1.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${asset.enabled ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400'}`}>
                                  {asset.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                                {asset.paused && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400">
                                    Paused
                                  </span>
                                )}
                                {asset.isNumeraire && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                                    Numeraire
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground min-w-fit">Token:</span>
                                <span className="font-mono truncate flex-1">{asset.token}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(asset.token, `token-${index}`)}
                                  className="h-5 w-5 p-0 hover:bg-purple-100 dark:hover:bg-purple-900/30 flex-shrink-0"
                                  title="Copy token address"
                                >
                                  {copiedId === `token-${index}` ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground min-w-fit">Asset ID:</span>
                                <span className="font-mono truncate flex-1">{asset.id}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(asset.id, `asset-${index}`)}
                                  className="h-5 w-5 p-0 hover:bg-purple-100 dark:hover:bg-purple-900/30 flex-shrink-0"
                                  title="Copy asset ID"
                                >
                                  {copiedId === `asset-${index}` ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>

                          {/* Right Section - Admin Controls (Admin Only) */}
                          {vaultInfo?.isAdmin && (
                            <div className="flex gap-2 flex-shrink-0">
                              <Button
                                onClick={() => updateAssetStatus(asset.id, !asset.enabled, asset.paused)}
                                disabled={updatingAssetId === asset.id}
                                size="sm"
                                variant={asset.enabled ? "outline" : "default"}
                                className="whitespace-nowrap cursor-pointer"
                              >
                                {updatingAssetId === asset.id ? 'Updating...' : (asset.enabled ? 'Disable' : 'Enable')}
                              </Button>
                              
                              {asset.enabled && (
                                <Button
                                  onClick={() => updateAssetStatus(asset.id, asset.enabled, !asset.paused)}
                                  disabled={updatingAssetId === asset.id}
                                  size="sm"
                                  variant="outline"
                                  className="whitespace-nowrap cursor-pointer"
                                >
                                  {asset.paused ? 'Unpause' : 'Pause'}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

      {/* Empty State - When No Assets */}
      {vaultInfo && vaultInfo.totalAssets === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm p-8 text-center">
          <Package className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <h3 className="text-lg font-semibold mb-2">No Assets Registered</h3>
          <p className="text-muted-foreground text-sm">
            {vaultInfo.isAdmin 
              ? "No assets have been registered yet. Use the form above to register your first asset."
              : "No assets have been registered for this vault yet."}
          </p>
        </div>
      )}
    </div>
  );
}
