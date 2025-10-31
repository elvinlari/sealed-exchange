"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Button } from '@/components/ui/button';
import { useWalletStore } from '@/stores/wallet-store';
import { CheckCircle, XCircle } from 'lucide-react';
import { useVaultContext } from '@/hooks/useVaultContext';

// Predefined market addresses sourced from environment variables
const envMarketCbtcCusdt = import.meta.env.VITE_MARKET_CBTC_CUSDT_ADDRESS as string | undefined;
const envMarketCethCusdt = import.meta.env.VITE_MARKET_CETH_CUSDT_ADDRESS as string | undefined;
const envMarketCgoldCusdt = import.meta.env.VITE_MARKET_CGOLD_CUSDT_ADDRESS as string | undefined;

export const MARKET_ADDRESS_BOOK: { name: string; address: string }[] = [
  ...(envMarketCbtcCusdt ? [{ name: 'cBTC/cUSDT', address: envMarketCbtcCusdt }] : []),
  ...(envMarketCethCusdt ? [{ name: 'cETH/cUSDT', address: envMarketCethCusdt }] : []),
  ...(envMarketCgoldCusdt ? [{ name: 'cGOLD/cUSDT', address: envMarketCgoldCusdt }] : []),
];

// Fast lookup from address -> name (case-insensitive)
const MARKET_ADDRESS_MAP = new Map<string, string>(
  MARKET_ADDRESS_BOOK.map((m) => [m.address.toLowerCase(), m.name])
);

function resolveMarketName(address: string): string | null {
  return MARKET_ADDRESS_MAP.get(address?.toLowerCase?.() ?? '') ?? null;
}

export function VaultMarkets() {
  const { provider, signer } = useWalletStore();
  const { vaultInfo, setVaultInfo, loadVaultInfo, vaultAddress, vaultAbi, setStatus, setError } = useVaultContext();

  // Form states - Market approval
  const [marketAddress, setMarketAddress] = useState<string>("");

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  // UI states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [revokingMarket, setRevokingMarket] = useState<string | null>(null);

  // Load markets page when currentPage changes
  useEffect(() => {
    if (provider && vaultInfo) {
      loadMarkets(currentPage);
    }
  }, [currentPage, provider, vaultInfo?.totalMarkets]);

  // Load paginated markets
  const loadMarkets = async (page: number) => {
    if (!provider) return;
    
    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, provider);
      const offset = (page - 1) * itemsPerPage;
      const marketAddresses = await contract.listMarkets(offset, itemsPerPage);
      
      setVaultInfo(prev => prev ? { ...prev, markets: marketAddresses } : null);
    } catch (err) {
      console.error("Failed to load markets:", err);
    }
  };

  const approveMarket = async () => {
    if (!signer || !vaultInfo?.isAdmin) return;
    if (!marketAddress.trim()) {
      setError({ title: "Invalid Input", description: "Please provide a market address" });
      return;
    }

    // Validate address format
    if (!ethers.isAddress(marketAddress)) {
      setError({ title: "Invalid Address", description: "Please provide a valid Ethereum address" });
      return;
    }

    setIsLoading(true);
    setStatus('Approving market...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      const tx = await contract.setMarketApproved(marketAddress, true);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus('Market approved successfully!');
      
      // Clear form
      setMarketAddress("");
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error approving market:", err);
      setError({
        title: "Approval Failed",
        description: err.message || "Could not approve market"
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const revokeMarketApproval = async (market: string) => {
    if (!signer || !vaultInfo?.isAdmin) return;

    setRevokingMarket(market);
    setStatus('Revoking market approval...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      const tx = await contract.setMarketApproved(market, false);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus('Market approval revoked successfully!');
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error revoking market approval:", err);
      setError({
        title: "Revoke Failed",
        description: err.message || "Could not revoke market approval"
      });
    } finally {
      setRevokingMarket(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div className="w-full">
      {/* Market Management - Admin Only */}
      {vaultInfo?.isAdmin && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-lg p-6 border border-green-200 dark:border-green-800 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <h2 className="text-lg font-semibold">Approve Market</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Select Market</label>
              {MARKET_ADDRESS_BOOK.length > 0 ? (
                <select
                  value={marketAddress}
                  onChange={(e) => setMarketAddress(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                >
                  <option value="" disabled>
                    Select a market…
                  </option>
                  {MARKET_ADDRESS_BOOK.map((m) => (
                    <option key={m.address} value={m.address}>
                      {m.name} — {m.address}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No predefined markets configured. Set VITE_MARKET_CBTC_CUSDT_ADDRESS in your .env.
                </p>
              )}
            </div>
          </div>

          <Button
            onClick={approveMarket}
            disabled={isLoading || !marketAddress.trim()}
            className="w-full mt-4 cursor-pointer"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Approve Market
          </Button>
        </div>
      )}

      {/* Approved Markets List - Public View */}
      {vaultInfo && vaultInfo.totalMarkets > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          {(() => {
            const totalPages = Math.ceil(vaultInfo.totalMarkets / itemsPerPage);

            return (
              <>
                {/* Header with pagination controls */}
                <div className="flex items-center justify-between mb-4 gap-4 p-4">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <h3 className="font-semibold">Approved Markets</h3>
                      <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full text-sm font-medium">
                        {vaultInfo.totalMarkets} {vaultInfo.totalMarkets === 1 ? 'market' : 'markets'}
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

                  {/* Markets List */}
                  <div className="divide-y divide-gray-200 dark:divide-gray-800 overflow-y-auto max-h-[70vh] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                    {vaultInfo.markets.map((market, index) => (
                      <div
                        key={index}
                        className="p-4 hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 dark:hover:from-green-950/10 dark:hover:to-emerald-950/10 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-base font-semibold bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-400 dark:to-emerald-400 bg-clip-text text-transparent">
                                {resolveMarketName(market) || `Market #${index + 1 + (currentPage - 1) * itemsPerPage}`}
                              </h3>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400">
                                Approved
                              </span>
                            </div>
                            <p className="text-sm font-mono text-muted-foreground truncate">
                              {market}
                            </p>
                          </div>

                          {/* Revoke Button - Admin Only */}
                          {vaultInfo?.isAdmin && (
                            <Button
                              onClick={() => revokeMarketApproval(market)}
                              disabled={revokingMarket === market}
                              size="sm"
                              variant="destructive"
                              className="flex-shrink-0 cursor-pointer"
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              {revokingMarket === market ? 'Revoking...' : 'Revoke'}
                            </Button>
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

      {/* Empty State - When No Markets */}
      {vaultInfo && vaultInfo.totalMarkets === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm p-8 text-center">
          <CheckCircle className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <h3 className="text-lg font-semibold mb-2">No Markets Approved</h3>
          <p className="text-muted-foreground text-sm">
            {vaultInfo.isAdmin 
              ? "No markets have been approved yet. Use the form above to approve your first market."
              : "No markets have been approved for this vault yet."}
          </p>
        </div>
      )}
    </div>
  );
}
