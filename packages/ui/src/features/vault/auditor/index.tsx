"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Button } from '@/components/ui/button';
import { useWalletStore } from '@/stores/wallet-store';
import { UserPlus, Users, UserMinus } from 'lucide-react';
import { useVaultContext } from '@/hooks/useVaultContext';

export function VaultAuditors() {
  const { provider, signer, account } = useWalletStore();
  const { vaultInfo, setVaultInfo, loadVaultInfo, vaultAddress, vaultAbi, setStatus, setError } = useVaultContext();

  // Form states - Auditor grant
  const [auditorAddress, setAuditorAddress] = useState<string>("");

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  // UI states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [revokingAuditor, setRevokingAuditor] = useState<string | null>(null);

  // Load auditors page when currentPage changes
  useEffect(() => {
    if (provider && vaultInfo) {
      loadAuditors(currentPage);
    }
  }, [currentPage, provider, vaultInfo?.totalAuditors]);

  // Load paginated auditors
  const loadAuditors = async (page: number) => {
    if (!provider) return;
    
    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, provider);
      const offset = (page - 1) * itemsPerPage;
      const listFn = contract.getFunction('listAuditors');
      const result = await listFn.staticCall(offset, itemsPerPage, { from: account });
      
      // listAuditors returns [address[] page, uint256 total]
      const auditorAddresses = Array.isArray(result) ? (result[0] || result) : result;
      
      setVaultInfo(prev => prev ? { ...prev, auditors: auditorAddresses } : null);
    } catch (err) {
      console.error("Failed to load auditors:", err);
    }
  };

  const grantAuditor = async () => {
    if (!signer || !vaultInfo?.isAdmin) return;
    if (!auditorAddress.trim()) {
      setError({ title: "Invalid Input", description: "Please provide an auditor address" });
      return;
    }

    // Validate address format
    if (!ethers.isAddress(auditorAddress)) {
      setError({ title: "Invalid Address", description: "Please provide a valid Ethereum address" });
      return;
    }

    setIsLoading(true);
    setStatus('Granting auditor role...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      const tx = await contract.grantAuditorRole(auditorAddress);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus('Auditor role granted successfully!');
      
      // Clear form
      setAuditorAddress("");
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error granting auditor role:", err);
      setError({
        title: "Grant Failed",
        description: err.message || "Could not grant auditor role"
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const revokeAuditor = async (auditor: string) => {
    if (!signer || !vaultInfo?.isAdmin) return;

    setRevokingAuditor(auditor);
    setStatus('Revoking auditor role...');
    setError(null);

    try {
      const contract = new ethers.Contract(vaultAddress, vaultAbi, signer);
      
      const tx = await contract.revokeAuditorRole(auditor);
      setStatus('Transaction submitted. Waiting for confirmation...');
      
      await tx.wait();
      setStatus('Auditor role revoked successfully!');
      
      // Reload vault info
      await loadVaultInfo();
    } catch (err: any) {
      console.error("Error revoking auditor role:", err);
      setError({
        title: "Revoke Failed",
        description: err.message || "Could not revoke auditor role"
      });
    } finally {
      setRevokingAuditor(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  if (!vaultInfo?.isAdmin) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg p-8 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
        <Users className="h-16 w-16 mx-auto mb-4 text-gray-400" />
        <h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <p className="text-muted-foreground">
          You need admin privileges to manage vault auditors.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Auditor Management */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h2 className="text-lg font-semibold">Grant Auditor Role</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Auditor Address</label>
            <input
              type="text"
              placeholder="Auditor Address (0x...)"
              value={auditorAddress}
              onChange={(e) => setAuditorAddress(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>
        </div>

        <Button
          onClick={grantAuditor}
          disabled={isLoading || !auditorAddress.trim()}
          className="w-full mt-4 cursor-pointer"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Grant Auditor Role
        </Button>

        {/* Auditors List */}
        {vaultInfo.totalAuditors > 0 && (
          <div className="mt-6">
            {(() => {
              const totalPages = Math.ceil(vaultInfo.totalAuditors / itemsPerPage);

              return (
                <>
                  {/* Header with pagination controls */}
                  <div className="flex items-center justify-between mb-4 gap-4">
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <h3 className="font-semibold">Current Auditors</h3>
                      <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-full text-sm font-medium">
                        {vaultInfo.totalAuditors} {vaultInfo.totalAuditors === 1 ? 'auditor' : 'auditors'}
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

                  {/* Auditors List */}
                  <div className="divide-y divide-gray-200 dark:divide-gray-800 overflow-y-auto max-h-[70vh] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                    {vaultInfo.auditors.map((auditor, index) => {
                      const auditorAddress = typeof auditor === 'string' ? auditor : String(auditor);
                      const isCurrentUser = account && auditorAddress.toLowerCase() === account.toLowerCase();
                      
                      return (
                        <div
                          key={index}
                          className="p-4 hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 dark:hover:from-blue-950/10 dark:hover:to-cyan-950/10 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-1">
                                <h3 className="text-base font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                                  Auditor #{index + 1 + (currentPage - 1) * itemsPerPage}
                                </h3>
                                <div className="flex gap-1.5">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                                    Active
                                  </span>
                                  {isCurrentUser && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                                      You
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm font-mono text-muted-foreground truncate">
                                {auditorAddress}
                              </p>
                            </div>

                            <Button
                              onClick={() => revokeAuditor(auditorAddress)}
                              disabled={revokingAuditor === auditorAddress}
                              size="sm"
                              variant="destructive"
                              className="flex-shrink-0 cursor-pointer"
                            >
                              <UserMinus className="h-4 w-4 mr-2" />
                              {revokingAuditor === auditorAddress ? 'Revoking...' : 'Revoke'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}

      {/* Empty State - When No Auditors */}
      {vaultInfo.totalAuditors === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm p-8 text-center">
          <Users className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <h3 className="text-lg font-semibold mb-2">No Auditors Assigned</h3>
          <p className="text-muted-foreground text-sm">
            No auditors have been granted the auditor role yet. Use the form above to grant your first auditor role.
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
