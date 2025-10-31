"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { createFhevmInstance } from "@sealed-exchange/fhevm-sdk";
import { Main } from '@/components/layout/main';
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
import AlertError from '@/components/alert-error';
import { useWalletStore } from '@/stores/wallet-store';
import { Wallet, Eye, RefreshCw, TrendingUp, Copy, Check, Send, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { decryptValue } from '@/lib/fhevm-decrypt';
import { getTokenMaxDecimalsForAddress, stepFromDecimals, formatAmountLocale } from '@/lib/token-decimals';

// Load token contract addresses from environment variables
const TOKEN_CONTRACTS = [
  {
    address: import.meta.env.VITE_TOKEN_CUSDT_ADDRESS,
    name: "Confidential USDT",
    symbol: "CUSDT",
  },
  {
    address: import.meta.env.VITE_TOKEN_CBTC_ADDRESS,
    name: "Confidential BTC",
    symbol: "CBTC",
  },
  {
    address: import.meta.env.VITE_TOKEN_CETH_ADDRESS,
    name: "Confidential ETH",
    symbol: "CETH",
  },
  {
    address: import.meta.env.VITE_TOKEN_CGOLD_ADDRESS,
    name: "Confidential GOLD",
    symbol: "CGOLD",
  },
].filter(token => token.address);

const minimalAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (bytes32)",
  "function transfer(address to, bytes calldata encryptedAmount) returns (bool)",
  "event Transfer(address indexed from, address indexed to)",
];

type TokenBalance = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  encryptedBalance: string;
  decryptedBalance: string | null;
  isDecrypting: boolean;
  error?: string | null;
};

export function Wallets() {
  const { provider, signer, account, connectWallet } = useWalletStore();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  
  // Transfer state
  const [transferDialogOpen, setTransferDialogOpen] = useState<boolean>(false);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [transferRecipient, setTransferRecipient] = useState<string>("");
  const [transferAmount, setTransferAmount] = useState<string>("");
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  
  // Receive state
  const [receiveDialogOpen, setReceiveDialogOpen] = useState<boolean>(false);
  const [receiveToken, setReceiveToken] = useState<TokenBalance | null>(null);
  const [addressCopied, setAddressCopied] = useState<boolean>(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

  // Copy address to clipboard
  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // Load token balances
  const loadBalances = async () => {
    if (!provider || !account) return;

    setIsLoading(true);
    setError(null);

    try {
      const balances = await Promise.all(
        TOKEN_CONTRACTS.map(async (token) => {
          try {
            const contract = new ethers.Contract(token.address, minimalAbi, provider);
            
            const [name, symbol, decimals, encBalance] = await Promise.all([
              contract.name(),
              contract.symbol(),
              contract.decimals(),
              contract.balanceOf(account),
            ]);

            return {
              address: token.address,
              name: name || token.name,
              symbol: symbol || token.symbol,
              decimals: Number(decimals),
              encryptedBalance: encBalance || "0x",
              decryptedBalance: null,
              isDecrypting: false,
              error: null,
            };
          } catch (err: any) {
            console.error(`Error loading ${token.symbol}:`, err);
            return {
              address: token.address,
              name: token.name,
              symbol: token.symbol,
              decimals: 18,
              encryptedBalance: "0x",
              decryptedBalance: null,
              isDecrypting: false,
              error: err.message || "Failed to load",
            };
          }
        })
      );

      setTokens(balances);
    } catch (err: any) {
      console.error("Error loading balances:", err);
      setError({
        title: "Failed to Load Balances",
        description: err.message || "Could not load token balances"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Decrypt a specific token balance
  const decryptBalance = async (tokenAddress: string) => {
    if (!provider || !signer || !account) return;

    const token = tokens.find(t => t.address === tokenAddress);
    if (!token || !token.encryptedBalance || token.encryptedBalance === "0x") {
      return;
    }

    // Update token state to show it's decrypting
    setTokens(prev => prev.map(t => 
      t.address === tokenAddress ? { ...t, isDecrypting: true, error: null } : t
    ));

    try {
      const value = await decryptValue(
        token.encryptedBalance,
        tokenAddress,
        token.decimals,
        provider,
        signer
      );

      setTokens(prev => prev.map(t => 
        t.address === tokenAddress 
          ? { ...t, decryptedBalance: value, isDecrypting: false } 
          : t
      ));
    } catch (err: any) {
      console.error(`Error decrypting ${token.symbol}:`, err);
      setTokens(prev => prev.map(t => 
        t.address === tokenAddress 
          ? { ...t, isDecrypting: false, error: "Failed to decrypt" } 
          : t
      ));
    }
  };

  // Decrypt all balances
  const decryptAllBalances = async () => {
    for (const token of tokens) {
      if (token.encryptedBalance && token.encryptedBalance !== "0x") {
        await decryptBalance(token.address);
      }
    }
  };

  // Open transfer dialog
  const openTransferDialog = (token: TokenBalance) => {
    setSelectedToken(token);
    setTransferRecipient("");
    setTransferAmount("");
    setTransferDialogOpen(true);
  };

  // Handle transfer
  const handleTransfer = async () => {
    if (!signer || !provider || !selectedToken) return;

    if (!transferRecipient || !ethers.isAddress(transferRecipient)) {
      setError({
        title: "Invalid Address",
        description: "Please enter a valid Ethereum address"
      });
      return;
    }

    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      setError({
        title: "Invalid Amount",
        description: "Please enter a valid amount"
      });
      return;
    }

    setIsTransferring(true);
    setError(null);

    try {
      // Create FHEVM instance for encryption
      const eip1193 = {
        request: async ({ method, params }: { method: string; params?: any[] }) =>
          (provider as any).send(method, params ?? [])
      };
      const fhe = await createFhevmInstance({
        provider: eip1193 as any,
        signal: new AbortController().signal,
        mockChains: undefined
      });

      // Encrypt the amount
      const amountBigInt = ethers.parseUnits(transferAmount, selectedToken.decimals);
      const encryptedAmount = (fhe as any).encrypt64(amountBigInt);

      // Execute transfer
      const contract = new ethers.Contract(selectedToken.address, minimalAbi, signer);
      const tx = await contract.transfer(transferRecipient, encryptedAmount);
      
      await tx.wait();

      // Refresh balances
      await loadBalances();

      // Close dialog and reset
      setTransferDialogOpen(false);
      setTransferRecipient("");
      setTransferAmount("");
      setSelectedToken(null);

      setError({
        title: "Transfer Successful",
        description: `Successfully transferred ${transferAmount} ${selectedToken.symbol}`
      });
    } catch (err: any) {
      console.error("Transfer error:", err);
      setError({
        title: "Transfer Failed",
        description: err.message || "Could not complete transfer"
      });
    } finally {
      setIsTransferring(false);
    }
  };

  // Request tokens (open receive dialog)
  const handleRequestTokens = (token: TokenBalance) => {
    setReceiveToken(token);
    setReceiveDialogOpen(true);
    setAddressCopied(false);
  };

  // Copy wallet address
  const copyWalletAddress = async () => {
    if (account) {
      try {
        await navigator.clipboard.writeText(account);
        setAddressCopied(true);
        setTimeout(() => setAddressCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy address:', err);
      }
    }
  };

  // Load balances on mount and when account changes
  useEffect(() => {
    if (account) {
      loadBalances();
    } else {
      setTokens([]);
    }
  }, [provider, account]);

  // Update selectedToken when tokens change (for decrypt updates)
  useEffect(() => {
    if (selectedToken && transferDialogOpen) {
      const updatedToken = tokens.find(t => t.address === selectedToken.address);
      if (updatedToken) {
        setSelectedToken(updatedToken);
      }
    }
  }, [tokens, transferDialogOpen]);

  // Reset to page 1 when tokens change
  useEffect(() => {
    setCurrentPage(1);
  }, [tokens.length]);

  // Calculate pagination
  const totalPages = Math.ceil(tokens.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTokens = tokens.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  // Calculate total value (if we have prices, placeholder for now)
  const getTotalValue = () => {
    // This would integrate with a price oracle
    return "—";
  };

  if (!account) {
    return (
      <Main>
        <div className="bg-white dark:bg-gray-900 rounded-lg p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
          <Wallet className="h-16 w-16 mx-auto mb-4 text-gray-400" />
          <h2 className="text-2xl font-bold mb-2">No Wallet Connected</h2>
          <p className="text-muted-foreground mb-6">
            Connect your wallet to view your token balances
          </p>
          <Button onClick={connectWallet} size="lg" className="cursor-pointer">
            <Wallet className="h-5 w-5 mr-2" />
            Connect Wallet
          </Button>
        </div>
      </Main>
    );
  }

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
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Wallet className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              Token Balances
            </h1>
            <p className="text-muted-foreground mt-1">
              View your encrypted token balances
            </p>
          </div>
        </div>

        {/* Summary Card */}
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Portfolio Value</p>
              <p className="text-3xl font-bold">{getTotalValue()}</p>
            </div>
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <TrendingUp className="h-5 w-5" />
              <span className="text-sm font-medium">—</span>
            </div>
          </div>
        </div>

        {/* Balances Table */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          {isLoading && tokens.length === 0 ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading balances...</p>
            </div>
          ) : tokens.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No tokens configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Token
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Contract Address
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Encrypted Balance
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Decrypted Balance
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedTokens.map((token) => (
                    <tr 
                      key={token.address}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      {/* Token Info */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                            {token.symbol.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-medium">{token.name}</div>
                            <div className="text-sm text-muted-foreground">{token.symbol}</div>
                          </div>
                        </div>
                      </td>

                      {/* Contract Address */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                            {token.address.substring(0, 6)}...{token.address.substring(38)}
                          </code>
                          <Button
                            onClick={() => copyAddress(token.address)}
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 cursor-pointer"
                            title={copiedAddress === token.address ? "Copied!" : "Copy address"}
                          >
                            {copiedAddress === token.address ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </td>

                      {/* Encrypted Balance */}
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                          {token.encryptedBalance === "0x" 
                            ? "—" 
                            : `${token.encryptedBalance.substring(0, 10)}...`}
                        </code>
                      </td>

                      {/* Decrypted Balance */}
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {token.isDecrypting ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                            <span className="text-sm text-muted-foreground">Decrypting...</span>
                          </div>
                        ) : token.error ? (
                          <span className="text-sm text-red-500">{token.error}</span>
                        ) : token.decryptedBalance !== null ? (
                          <div className="font-medium">
                            {formatAmountLocale(
                              token.decryptedBalance,
                              getTokenMaxDecimalsForAddress(token.address, token.decimals)
                            )} {token.symbol}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            onClick={() => decryptBalance(token.address)}
                            disabled={token.isDecrypting || !token.encryptedBalance || token.encryptedBalance === "0x"}
                            size="sm"
                            variant="ghost"
                            className="cursor-pointer"
                          >
                            {token.decryptedBalance !== null ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Refresh
                              </>
                            ) : (
                              <>
                                <Eye className="h-4 w-4 mr-1" />
                                Decrypt
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => openTransferDialog(token)}
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                          >
                            <Send className="h-4 w-4 mr-1" />
                            Send
                          </Button>
                          <Button
                            onClick={() => handleRequestTokens(token)}
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Receive
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Table Footer */}
          {tokens.length > 0 && (
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1}-{Math.min(endIndex, tokens.length)} of {tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={loadBalances}
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
                    disabled={isLoading || tokens.length === 0}
                    size="sm"
                    className="cursor-pointer"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Decrypt All
                  </Button>
                </div>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Items per page:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-900 cursor-pointer"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </div>

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
          )}
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            💡 <strong>Privacy Note:</strong> Your balances are encrypted on-chain. Click "Decrypt" to view the actual amounts using your wallet signature.
          </p>
        </div>

        {/* Transfer Dialog */}
        <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>
                Send {selectedToken?.symbol}
              </DialogTitle>
              <DialogDescription>
                Transfer encrypted {selectedToken?.name} tokens to another address
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient Address</Label>
                <Input
                  id="recipient"
                  placeholder="0x..."
                  value={transferRecipient}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTransferRecipient(e.target.value)}
                  disabled={isTransferring}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="0.0"
                  value={transferAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTransferAmount(e.target.value)}
                  disabled={isTransferring}
                  step={
                    selectedToken
                      ? stepFromDecimals(getTokenMaxDecimalsForAddress(selectedToken.address, selectedToken.decimals))
                      : 'any'
                  }
                />
                {selectedToken?.decryptedBalance && (
                  <p className="text-xs text-muted-foreground">
                    Available: {formatAmountLocale(
                      selectedToken.decryptedBalance,
                      getTokenMaxDecimalsForAddress(selectedToken.address, selectedToken.decimals)
                    )} {selectedToken.symbol}
                  </p>
                )}
              </div>

              {selectedToken && !selectedToken.decryptedBalance && (
                <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 flex-1">
                      ⚠️ Decrypt your balance to see available amount before sending
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (selectedToken) {
                          await decryptBalance(selectedToken.address);
                          // Update selectedToken with the new decrypted value
                          const updatedToken = tokens.find(t => t.address === selectedToken.address);
                          if (updatedToken) {
                            setSelectedToken(updatedToken);
                          }
                        }
                      }}
                      disabled={selectedToken.isDecrypting}
                      className="cursor-pointer shrink-0"
                    >
                      {selectedToken.isDecrypting ? (
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
                  setTransferDialogOpen(false);
                  setTransferRecipient("");
                  setTransferAmount("");
                }}
                disabled={isTransferring}
              >
                Cancel
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={isTransferring || !transferRecipient || !transferAmount}
                className="cursor-pointer"
              >
                {isTransferring ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Tokens
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Receive Dialog */}
        <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>
                Receive {receiveToken?.symbol}
              </DialogTitle>
              <DialogDescription>
                Share your address to receive tokens
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              {/* Wallet Address Display */}
              <div className="space-y-2">
                <Label>Your Wallet Address</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <code className="text-sm font-mono break-all">
                      {account}
                    </code>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  💡 Copy and share this address with the sender. Your balance will update automatically after receiving tokens.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setReceiveDialogOpen(false);
                  setAddressCopied(false);
                }}
              >
                Close
              </Button>
              <Button
                onClick={copyWalletAddress}
                className="cursor-pointer"
              >
                <Copy className="h-4 w-4 mr-2" />
                {addressCopied ? 'Copied!' : 'Copy Address'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Main>
  );
}
