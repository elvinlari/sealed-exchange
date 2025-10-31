"use client";

import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Main } from '@/components/layout/main';
import { Button } from '@/components/ui/button';
import AlertError from '@/components/alert-error';
import { useWalletStore } from '@/stores/wallet-store';
import { Activity, Filter, RefreshCw, ExternalLink } from 'lucide-react';

// Load contract addresses from environment variables
const TOKEN_CONTRACTS = [
  import.meta.env.VITE_TOKEN_CUSDT_ADDRESS, // CUSDT
  import.meta.env.VITE_TOKEN_CBTC_ADDRESS,  // CBTC
].filter(Boolean);

// MarketPair contracts: use explicit env vars with friendly names
const envMarketCbtcCusdt = import.meta.env.VITE_MARKET_CBTC_CUSDT_ADDRESS as string | undefined;
const envMarketCethCusdt = import.meta.env.VITE_MARKET_CETH_CUSDT_ADDRESS as string | undefined;
const envMarketCgoldCusdt = import.meta.env.VITE_MARKET_CGOLD_CUSDT_ADDRESS as string | undefined;

export const MARKET_ADDRESS_BOOK: { name: string; address: string }[] = [
  ...(envMarketCbtcCusdt ? [{ name: 'cBTC/cUSDT', address: envMarketCbtcCusdt }] : []),
  ...(envMarketCethCusdt ? [{ name: 'cETH/cUSDT', address: envMarketCethCusdt }] : []),
  ...(envMarketCgoldCusdt ? [{ name: 'cGOLD/cUSDT', address: envMarketCgoldCusdt }] : []),
];

const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS;

// Validate that contract addresses are configured
if (TOKEN_CONTRACTS.length === 0) {
  console.warn('No token contracts configured in environment variables');
}
if (MARKET_ADDRESS_BOOK.length === 0) {
  console.warn('No market pair contracts configured in environment variables');
}
if (!VAULT_ADDRESS) {
  console.warn('VITE_VAULT_ADDRESS not configured');
}

const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const vaultAbi = [
  "event AdminChanged(address indexed oldAdmin, address indexed newAdmin)",
  "event MarketApproved(address indexed market, bool approved)",
  "event AssetRegistered(bytes32 indexed assetId, address token, bool isNumeraire)",
  "event AssetStatus(bytes32 indexed assetId, bool enabled, bool paused)",
  "event Deposit(address indexed trader, bytes32 indexed assetId)",
  "event Withdraw(address indexed trader, bytes32 indexed assetId)",
  "event Reserved(address indexed trader, bytes32 indexed assetId, address indexed market, uint64 batchId, bytes32 eAmtHash)",
  "event Released(address indexed trader, bytes32 indexed assetId, address indexed market, uint64 batchId, bytes32 eAmtHash)",
  "event SettledBuy(address indexed buyer, address indexed market, uint64 batchId, bytes32 baseFillHash, bytes32 quoteDebitHash)",
  "event SettledSell(address indexed seller, address indexed market, uint64 batchId, bytes32 baseDebitHash, bytes32 quoteCreditHash)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
];

// MarketPair events (types aligned to decoding expectations)
const marketPairAbi = [
  // order intake & admin
  "event Submitted(address indexed trader, uint64 batchId, uint8 side, uint8 tick, uint256 orderId)",
  "event Cancelled(address indexed trader, uint64 batchId, uint256 orderId)",
  "event CloseWindowUpdated(uint64 oldSeconds, uint64 newSeconds)",
  // batch finalization & settlement
  "event ClearingChosen(uint64 indexed batchId, bytes pIdxEnc, bytes matchedEnc, bytes priceEnc, bytes recipEnc)",
  "event Settled(uint64 indexed batchId, bytes pIdxEnc)",
];

type ContractInfo = {
  address: string;
  name: string;
  type: 'token' | 'vault' | 'market';
};

type EventData = {
  contract: ContractInfo;
  event: any;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  eventName: string;
};

export const Events: React.FC = () => {
  const { provider, checkConnection } = useWalletStore();
  
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [allEvents, setAllEvents] = useState<EventData[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventData[]>([]);
  const [selectedContract, setSelectedContract] = useState<string>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Check for existing wallet connection on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Load all contracts
  useEffect(() => {
    const loadContracts = async () => {
      if (!provider) return;

      const contractList: ContractInfo[] = [];

      // Load token contracts
      for (const tokenAddress of TOKEN_CONTRACTS) {
        try {
          const contract = new ethers.Contract(tokenAddress, tokenAbi, provider as any);
          const [name, symbol] = await Promise.all([
            contract.name(),
            contract.symbol(),
          ]);
          contractList.push({
            address: tokenAddress,
            name: `${name} (${symbol})`,
            type: 'token',
          });
        } catch (e) {
          console.error(`Failed to load token ${tokenAddress}:`, e);
        }
      }

      // Load market pair contracts (named)
      for (const entry of MARKET_ADDRESS_BOOK) {
        try {
          // Attach ABI for events; name comes from address book
          new ethers.Contract(entry.address, marketPairAbi, provider as any);
          contractList.push({
            address: entry.address,
            name: entry.name,
            type: 'market',
          });
        } catch (e) {
          console.error(`Failed to load market ${entry.address}:`, e);
        }
      }

      // Add Vault contract
      if (VAULT_ADDRESS) {
        contractList.push({
          address: VAULT_ADDRESS,
          name: 'Vault Contract',
          type: 'vault',
        });
      }

      setContracts(contractList);
    };

    loadContracts();
  }, [provider]);

  // Load events from all contracts
  useEffect(() => {
    const loadAllEvents = async () => {
      if (!provider || contracts.length === 0) return;

      setIsLoading(true);
      setStatus('Loading events from all contracts...');

      try {
        const allEventsData: EventData[] = [];
        const latest = await (provider as any).getBlockNumber();
        const fromBlock = Math.max(0, latest - 2000); // Last 2000 blocks

        for (const contractInfo of contracts) {
          try {
            const abi = contractInfo.type === 'token' ? tokenAbi : (contractInfo.type === 'vault' ? vaultAbi : marketPairAbi);
            const contract = new ethers.Contract(contractInfo.address, abi, provider as any);

            // Get all events (null filter gets all events)
            const events = await contract.queryFilter('*', fromBlock, latest);

            for (const event of events) {
              // Extract event name safely
              const eventName = 
                ('eventName' in event && event.eventName) ||
                ('fragment' in event && event.fragment?.name) ||
                'Unknown';
              
              allEventsData.push({
                contract: contractInfo,
                event: event,
                blockNumber: event.blockNumber,
                logIndex: event.index,
                transactionHash: event.transactionHash,
                eventName: eventName,
              });
            }
          } catch (e) {
            console.error(`Failed to load events for ${contractInfo.name}:`, e);
          }
        }

        // Sort by newest first (blockNumber desc, then logIndex desc)
        allEventsData.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return b.blockNumber - a.blockNumber;
          }
          return b.logIndex - a.logIndex;
        });

        setAllEvents(allEventsData);
        setFilteredEvents(allEventsData);
        setStatus(`Loaded ${allEventsData.length} events from ${contracts.length} contracts`);
      } catch (e: any) {
        console.error('Failed to load events:', e);
        setError({
          title: 'Failed to Load Events',
          description: e.message || String(e),
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadAllEvents();
  }, [provider, contracts]);

  // Filter events when selection changes
  useEffect(() => {
    let filtered = [...allEvents];

    if (selectedContract !== 'all') {
      filtered = filtered.filter(e => e.contract.address === selectedContract);
    }

    if (selectedEventType !== 'all') {
      filtered = filtered.filter(e => e.eventName === selectedEventType);
    }

    setFilteredEvents(filtered);
    setPage(1); // Reset to first page when filter changes
  }, [selectedContract, selectedEventType, allEvents]);

  const refreshEvents = () => {
    // Force reload by clearing contracts and letting useEffect reload
    setContracts([...contracts]);
  };

  // Get unique event types for filter
  const eventTypes = Array.from(new Set(allEvents.map(e => e.eventName))).sort();

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const paginatedEvents = filteredEvents.slice((page - 1) * pageSize, page * pageSize);

  // Format address for display
  const formatAddress = (addr: string) => {
    if (!addr) return '—';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Format bytes32 for display
  const formatBytes32 = (bytes: string) => {
    if (!bytes) return '—';
    if (bytes.length <= 10) return bytes;
    return `${bytes.slice(0, 10)}...`;
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

      <div className="mx-auto max-w-7xl px-4 lg:px-6 pt-3 pb-4">
        {/* Compact Header with Inline Filters */}
        <div className="flex flex-col gap-3 mb-4">
          {/* Title Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              <h1 className="text-2xl font-bold">Contract Events</h1>
              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 rounded text-xs font-medium">
                {filteredEvents.length} events
              </span>
            </div>
            <Button
              onClick={refreshEvents}
              variant="outline"
              size="sm"
              className="gap-2 cursor-pointer"
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          
          {/* Filters Row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <select
              value={selectedContract}
              onChange={(e) => setSelectedContract(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition text-xs"
            >
              <option value="all">All Contracts ({contracts.length})</option>
              <optgroup label="Tokens">
                {contracts.filter(c => c.type === 'token').map(c => (
                  <option key={c.address} value={c.address}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              {contracts.some(c => c.type === 'market') && (
                <optgroup label="Markets">
                  {contracts.filter(c => c.type === 'market').map(c => (
                    <option key={c.address} value={c.address}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {contracts.some(c => c.type === 'vault') && (
                <optgroup label="Vault">
                  {contracts.filter(c => c.type === 'vault').map(c => (
                    <option key={c.address} value={c.address}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition text-xs"
            >
              <option value="all">All Events ({eventTypes.length} types)</option>
              {eventTypes.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {(selectedContract !== 'all' || selectedEventType !== 'all') && (
              <Button
                onClick={() => {
                  setSelectedContract('all');
                  setSelectedEventType('all');
                }}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs cursor-pointer"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Events List */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          {/* Compact Pagination Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <select
                className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition text-xs"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs text-muted-foreground">per page</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="h-7 w-7 p-0 hover:bg-purple-50 dark:hover:bg-purple-950 cursor-pointer"
              >
                {"⏮"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 w-7 p-0 hover:bg-purple-50 dark:hover:bg-purple-950 cursor-pointer"
              >
                {"◀"}
              </Button>
              <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-medium min-w-[80px] text-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-7 w-7 p-0 hover:bg-purple-50 dark:hover:bg-purple-950 cursor-pointer"
              >
                {"▶"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="h-7 w-7 p-0 hover:bg-purple-50 dark:hover:bg-purple-950 cursor-pointer"
              >
                {"⏭"}
              </Button>
            </div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mx-auto mb-2"></div>
              <p className="text-xs text-muted-foreground">Loading events...</p>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredEvents.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <div className="text-3xl mb-2">📭</div>
              <div className="text-xs">No events found</div>
            </div>
          )}

          {/* Events - Table Layout */}
          {!isLoading && paginatedEvents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Event</th>
                    <th className="px-3 py-2 text-left font-semibold">Contract</th>
                    <th className="px-3 py-2 text-left font-semibold">Details</th>
                    <th className="px-3 py-2 text-center font-semibold">Block</th>
                    <th className="px-3 py-2 text-left font-semibold">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {paginatedEvents.map((eventData, idx) => {
                    // Get all arguments
                    const args = eventData.event.args || {};
                    const argKeys = Object.keys(args).filter(key => isNaN(Number(key)));
                    
                    return (
                      <tr
                        key={`${eventData.transactionHash}:${eventData.logIndex}:${idx}`}
                        className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                      >
                        {/* Event Name */}
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded font-semibold whitespace-nowrap">
                            {eventData.eventName}
                          </span>
                        </td>
                        
                        {/* Contract */}
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${
                            eventData.contract.type === 'vault'
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : eventData.contract.type === 'market'
                                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          }`}>
                            {eventData.contract.name}
                          </span>
                        </td>
                        
                        {/* Arguments/Details */}
                        <td className="px-3 py-2">
                          {argKeys.length > 0 ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                              {argKeys.map(key => {
                                const value = args[key];
                                let displayValue: string;

                                if (typeof value === 'bigint') {
                                  displayValue = value.toString();
                                } else if (ethers.isAddress(value)) {
                                  displayValue = formatAddress(value);
                                } else if (typeof value === 'string' && value.startsWith('0x')) {
                                  displayValue = formatBytes32(value);
                                } else if (typeof value === 'boolean') {
                                  displayValue = value ? '✓' : '✗';
                                } else {
                                  displayValue = String(value);
                                }

                                return (
                                  <span key={key} className="whitespace-nowrap">
                                    <span className="text-muted-foreground">{key}:</span>{' '}
                                    <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                                      {displayValue}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">No indexed params</span>
                          )}
                        </td>
                        
                        {/* Block */}
                        <td className="px-3 py-2 text-center">
                          <span className="font-mono text-muted-foreground">
                            {eventData.blockNumber}
                          </span>
                        </td>
                        
                        {/* Transaction */}
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-muted-foreground">
                              {formatAddress(eventData.transactionHash)}
                            </span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Compact Status Bar */}
        {status && (
          <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-800 text-xs text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
            <span className="font-medium">{status}</span>
          </div>
        )}
      </div>
    </Main>
  );
};
