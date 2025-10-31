"use client";

import { useState, useEffect, useMemo } from 'react';
import { Main } from '@/components/layout/main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/pagination';
import AlertError from '@/components/alert-error';
import { useWalletStore } from '@/stores/wallet-store';
import { MarketTradingProvider, useMarketTrading } from '@/hooks/useMarketTrading';
import { getTokenMaxDecimalsForAddress, stepFromDecimals } from '@/lib/token-decimals';
import { MARKET_ADDRESS_BOOK, getDefaultMarket } from '@/config/markets';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  ShoppingCart,
  Package,
  X,
  Loader2,
  AlertCircle,
  Activity
} from 'lucide-react';

type DashboardContentProps = {
  selectedMarket: string;
  onMarketChange: (address: string) => void;
};

function DashboardContent({ selectedMarket, onMarketChange }: DashboardContentProps) {
  const { account, connectWallet } = useWalletStore();
  const {
    marketInfo,
    batchInfo,
    userOrders,
    lastPriceDecrypted,
    isAdmin,
    revealClearingPrice,
    clearClearingPrice,
    submitBuyOrder,
    submitSellOrder,
    cancelOrder,
    finalizeBatch,
    settleBatch,
    openNewBatch,
    error,
    setError,
    isSubmitting,
    isRevealing,
    isFinalizing,
    isSettling,
    isOpeningBatch
  } = useMarketTrading();

  // Order form state
  const [selectedTick, setSelectedTick] = useState<number>(0);
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [partialFill, setPartialFill] = useState<boolean>(true);

  // Pagination state for orders
  const [currentPage, setCurrentPage] = useState<number>(1);
  const ordersPerPage = 3;

  // Auto-select middle tick on load
  useEffect(() => {
    if (marketInfo && marketInfo.ticks.length > 0) {
      setSelectedTick(Math.floor(marketInfo.ticks.length / 2));
    }
  }, [marketInfo]);

  // Reset to page 1 when orders change
  useEffect(() => {
    setCurrentPage(1);
  }, [userOrders]);

  // Calculate pagination
  const totalPages = Math.ceil(userOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const endIndex = startIndex + ordersPerPage;
  const paginatedOrders = useMemo(
    () => userOrders.slice(startIndex, endIndex),
    [userOrders, startIndex, endIndex]
  );

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    
    if (totalPages <= 7) {
      // Show all pages if 7 or less
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      if (currentPage <= 3) {
        // Near start: show 1, 2, 3, 4, ..., last
        pages.push(2, 3, 4);
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Near end: show 1, ..., last-3, last-2, last-1, last
        pages.push('ellipsis');
        pages.push(totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        // Middle: show 1, ..., current-1, current, current+1, ..., last
        pages.push('ellipsis');
        pages.push(currentPage - 1, currentPage, currentPage + 1);
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  // Countdown timer
  const [countdown, setCountdown] = useState<string>('—');

  useEffect(() => {
    if (!batchInfo) return;

    const updateCountdown = () => {
      const remaining = batchInfo.remainingSeconds;
      if (remaining <= 0) {
        setCountdown('Closed');
        return;
      }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [batchInfo]);

  const handleBuySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyAmount || !marketInfo) return;
    await submitBuyOrder(selectedTick, buyAmount, partialFill);
    setBuyAmount('');
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellAmount || !marketInfo) return;
    await submitSellOrder(selectedTick, sellAmount, partialFill);
    setSellAmount('');
  };

  const handleCancelOrder = async (orderId: string) => {
    await cancelOrder(orderId);
  };

  if (!account) {
    return (
      <Main>
        <div className="bg-white dark:bg-gray-900 rounded-lg p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
          <Activity className="h-16 w-16 mx-auto mb-4 text-gray-400" />
          <h2 className="text-2xl font-bold mb-2">Connect to Trade</h2>
          <p className="text-muted-foreground mb-6">
            Connect your wallet to access the order book
          </p>
          <Button onClick={connectWallet} size="lg" className="cursor-pointer">
            Connect Wallet
          </Button>
        </div>
      </Main>
    );
  }

  if (!marketInfo) {
    return (
      <Main>
        <div className="bg-white dark:bg-gray-900 rounded-lg p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
          <Loader2 className="h-16 w-16 mx-auto mb-4 text-purple-600 animate-spin" />
          <h2 className="text-2xl font-bold mb-2">Loading Market...</h2>
          <p className="text-muted-foreground">
            Fetching order book data
          </p>
        </div>
      </Main>
    );
  }

  const selectedPrice = marketInfo.ticks[selectedTick]?.price || '0';
  const quoteMaxDecimals = getTokenMaxDecimalsForAddress(
    import.meta.env.VITE_TOKEN_CUSDT_ADDRESS,
    marketInfo.quoteDecimals
  );
  const baseMaxDecimals = getTokenMaxDecimalsForAddress(
    import.meta.env.VITE_TOKEN_CBTC_ADDRESS,
    marketInfo.baseDecimals
  );

  return (
    <Main>
      {error && (
        <AlertError
          title={error.title}
          description={error.description}
          onDismiss={() => setError(null)}
        />
      )}

      <div className="space-y-4">
        {/* Market Selector */}
        {MARKET_ADDRESS_BOOK.length > 1 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
            <Label htmlFor="market-select" className="text-sm font-medium mb-2 block">
              Select Market
            </Label>
            <select
              id="market-select"
              value={selectedMarket}
              onChange={(e) => onMarketChange(e.target.value)}
              className="w-full md:w-64 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-600"
            >
              {MARKET_ADDRESS_BOOK.map((market) => (
                <option key={market.address} value={market.address}>
                  {market.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Batch Controls */}
        {account && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-900 dark:text-blue-100">
                  <Activity className="h-5 w-5" />
                  Batch Controls
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Manage the current batch lifecycle
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={finalizeBatch}
                  disabled={isFinalizing || isSettling || batchInfo?.phase !== 'OPEN' || batchInfo?.orderCount === 0}
                  variant="outline"
                  className="bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
                >
                  {isFinalizing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Finalizing...
                    </>
                  ) : (
                    <>
                      <Package className="h-4 w-4 mr-2" />
                      Finalize Batch
                    </>
                  )}
                </Button>
                <Button
                  onClick={settleBatch}
                  disabled={isSettling || isFinalizing || batchInfo?.phase !== 'FROZEN' || batchInfo?.orderCount === 0}
                  variant="outline"
                  className="bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
                >
                  {isSettling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Settling...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4 mr-2" />
                      Settle Batch
                    </>
                  )}
                </Button>
                {isAdmin && (
                  <Button
                    onClick={() => openNewBatch(60)}
                    disabled={isOpeningBatch || isFinalizing || isSettling}
                    variant="outline"
                    className="bg-white dark:bg-gray-900 border-purple-300 dark:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/30 cursor-pointer"
                  >
                    {isOpeningBatch ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Opening...
                      </>
                    ) : (
                      <>
                        <Clock className="h-4 w-4 mr-2" />
                        Open New Batch (60s)
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            {batchInfo && (
              <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {batchInfo.phase === 'OPEN' && batchInfo.orderCount > 0 && (
                    <>
                      <strong>Ready to finalize:</strong> Batch #{batchInfo.currentBatchId} has {batchInfo.orderCount} order(s). 
                      Any trader can finalize to compute the clearing price.
                    </>
                  )}
                  {batchInfo.phase === 'FROZEN' && batchInfo.orderCount > 0 && (
                    <>
                      <strong>Ready to settle:</strong> Batch #{batchInfo.currentBatchId} is frozen. 
                      Any trader can settle to execute matched orders and open the next batch.
                    </>
                  )}
                  {batchInfo.orderCount === 0 && (
                    <>
                      <strong>No orders:</strong> Batch #{batchInfo.currentBatchId} has no orders yet.
                    </>
                  )}
                  {batchInfo.phase === 'OPEN' && batchInfo.orderCount === 0 && (
                    <> Wait for traders to submit orders before finalizing.</>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Header & Batch Status */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Activity className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              {marketInfo.baseSymbol}/{marketInfo.quoteSymbol} Trading
            </h1>
            <p className="text-muted-foreground mt-1">
              Confidential batch auction market
            </p>
          </div>

          {/* Batch Info Card */}
          {batchInfo && (
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Batch #{batchInfo.currentBatchId}</p>
                    <p className={`text-xl font-bold ${batchInfo.phase === 'OPEN' ? 'text-green-600' : 'text-red-600'}`}>
                      {batchInfo.phase}
                    </p>
                  </div>
                </div>
                <div className="border-l border-purple-200 dark:border-purple-800 pl-4">
                  <p className="text-xs text-muted-foreground">Time Remaining</p>
                  <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{countdown}</p>
                </div>
                <div className="border-l border-purple-200 dark:border-purple-800 pl-4">
                  <p className="text-xs text-muted-foreground">Orders</p>
                  <p className="text-xl font-bold">{batchInfo.orderCount}</p>
                </div>
                <div className="border-l border-purple-200 dark:border-purple-800 pl-4">
                  <p className="text-xs text-muted-foreground">
                    Last Clearing Price
                    {marketInfo && (
                      <span> ({marketInfo.quoteSymbol}/{marketInfo.baseSymbol})</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    {lastPriceDecrypted ? (
                      <>
                        <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                          {parseFloat(lastPriceDecrypted).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: quoteMaxDecimals
                          })}
                          {" "}
                          <span className="text-sm text-muted-foreground">{marketInfo.quoteSymbol}</span>
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearClearingPrice}
                          className="h-6 w-6 p-0"
                          title="Hide price"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={revealClearingPrice}
                        disabled={isRevealing}
                        className="h-8"
                        title="Reveal and decrypt clearing price"
                      >
                        {isRevealing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Revealing...
                          </>
                        ) : (
                          <>
                            <Activity className="h-4 w-4 mr-2" />
                            Reveal Price
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Trading Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Order Book */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  Price Ladder
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {marketInfo.ticks.length} price ticks
                </p>
              </div>
              <div className="overflow-y-auto max-h-[300px]">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {[...marketInfo.ticks].reverse().map((tick) => {
                    const isSelected = tick.index === selectedTick;
                    return (
                      <button
                        key={tick.index}
                        onClick={() => setSelectedTick(tick.index)}
                        className={`w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                          isSelected
                            ? 'bg-purple-50 dark:bg-purple-950/20 border-l-4 border-purple-600'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono">
                              #{tick.index}
                            </span>
                            <span className={`font-mono text-sm font-semibold ${
                              isSelected ? 'text-purple-600 dark:text-purple-400' : ''
                            }`}>
                              {parseFloat(tick.price).toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: quoteMaxDecimals
                              })}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {marketInfo.quoteSymbol}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Center: Order Entry */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm p-4">
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-semibold">Selected Price</span>
                </div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
                  {parseFloat(selectedPrice).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: quoteMaxDecimals
                  })} <span className="text-sm text-muted-foreground">{marketInfo.quoteSymbol}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Tick #{selectedTick} • Per 1 {marketInfo.baseSymbol}
                </p>
              </div>

              <Tabs defaultValue="buy" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="buy" className="cursor-pointer">
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Buy
                  </TabsTrigger>
                  <TabsTrigger value="sell" className="cursor-pointer">
                    <TrendingDown className="h-4 w-4 mr-2" />
                    Sell
                  </TabsTrigger>
                </TabsList>

                {/* Buy Tab */}
                <TabsContent value="buy" className="space-y-4 mt-4">
                  <form onSubmit={handleBuySubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="buy-amount">Amount ({marketInfo.quoteSymbol})</Label>
                      <Input
                        id="buy-amount"
                        type="number"
                        placeholder="0.0"
                        value={buyAmount}
                        onChange={(e) => setBuyAmount(e.target.value)}
                        disabled={isSubmitting || batchInfo?.phase !== 'OPEN'}
                        step={stepFromDecimals(quoteMaxDecimals)}
                        min="0"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Quote amount to spend at tick #{selectedTick}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="buy-partial"
                        checked={partialFill}
                        onChange={(e) => setPartialFill(e.target.checked)}
                        className="cursor-pointer"
                      />
                      <Label htmlFor="buy-partial" className="cursor-pointer">
                        Allow partial fill
                      </Label>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting || !buyAmount || batchInfo?.phase !== 'OPEN'}
                      className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Buy {marketInfo.baseSymbol}
                        </>
                      )}
                    </Button>
                  </form>

                  {batchInfo?.phase !== 'OPEN' && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                      <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Batch is frozen. Wait for next OPEN phase.
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* Sell Tab */}
                <TabsContent value="sell" className="space-y-4 mt-4">
                  <form onSubmit={handleSellSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="sell-amount">Amount ({marketInfo.baseSymbol})</Label>
                      <Input
                        id="sell-amount"
                        type="number"
                        placeholder="0.0"
                        value={sellAmount}
                        onChange={(e) => setSellAmount(e.target.value)}
                        disabled={isSubmitting || batchInfo?.phase !== 'OPEN'}
                        step={stepFromDecimals(baseMaxDecimals)}
                        min="0"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Base amount to sell at tick #{selectedTick}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sell-partial"
                        checked={partialFill}
                        onChange={(e) => setPartialFill(e.target.checked)}
                        className="cursor-pointer"
                      />
                      <Label htmlFor="sell-partial" className="cursor-pointer">
                        Allow partial fill
                      </Label>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting || !sellAmount || batchInfo?.phase !== 'OPEN'}
                      className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <TrendingDown className="h-4 w-4 mr-2" />
                          Sell {marketInfo.baseSymbol}
                        </>
                      )}
                    </Button>
                  </form>

                  {batchInfo?.phase !== 'OPEN' && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                      <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Batch is frozen. Wait for next OPEN phase.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Right: User Orders */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col h-full">
              <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  Your Orders
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {userOrders.length} total order{userOrders.length !== 1 ? 's' : ''}
                  {userOrders.length > ordersPerPage && (
                    <span> • Page {currentPage} of {totalPages}</span>
                  )}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {userOrders.length === 0 ? (
                  <div className="p-8 text-center">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm text-muted-foreground">No orders yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {paginatedOrders.map((order) => {
                      const canCancel = order.status === 'SUBMITTED' && batchInfo?.phase === 'OPEN';
                      return (
                        <div key={order.orderId} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {order.side === 'BUY' ? (
                                <TrendingUp className="h-4 w-4 text-green-600" />
                              ) : (
                                <TrendingDown className="h-4 w-4 text-red-600" />
                              )}
                              <span className={`text-sm font-semibold ${
                                order.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {order.side}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                order.status === 'SUBMITTED'
                                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  : order.status === 'SETTLED'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                              }`}>
                                {order.status}
                              </span>
                              {canCancel && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleCancelOrder(order.orderId)}
                                  className="h-7 px-2 flex items-center gap-1 cursor-pointer"
                                  title="Cancel this order"
                                  aria-label="Cancel order"
                                >
                                  <X className="h-4 w-4" />
                                  <span className="text-xs font-semibold hidden sm:inline">Cancel</span>
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {/* <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Tick</span>
                              <span className="font-mono font-medium">#{order.tick}</span>
                            </div> */}
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Price</span>
                              <span className="font-mono font-medium">
                                {parseFloat(order.price).toLocaleString(undefined, {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: quoteMaxDecimals
                                })} {marketInfo.quoteSymbol}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Batch</span>
                              <span className="font-mono font-medium">#{order.batchId}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Order ID</span>
                              <span className="font-mono font-medium">#{order.orderId}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* Pagination Controls */}
              {userOrders.length > ordersPerPage && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-800">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                        />
                      </PaginationItem>
                      
                      {getPageNumbers().map((page, index) => (
                        <PaginationItem key={index}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={() => setCurrentPage(page)}
                              isActive={currentPage === page}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Confidential Trading:</strong> Your order amounts are encrypted on-chain. The batch auction mechanism finds a clearing price (p*) that maximizes matched volume every batch cycle. Orders at favorable ticks are settled when the batch finalizes.
            </span>
          </p>
        </div>
      </div>
    </Main>
  );
}

// Wrap with provider following the same pattern as Balance and Vault features
export function Dashboard() {
  const [selectedMarketAddress, setSelectedMarketAddress] = useState<string>('');

  // Set default market on mount
  useEffect(() => {
    const defaultMarket = getDefaultMarket();
    if (defaultMarket && !selectedMarketAddress) {
      setSelectedMarketAddress(defaultMarket.address);
    }
  }, [selectedMarketAddress]);

  if (!selectedMarketAddress || MARKET_ADDRESS_BOOK.length === 0) {
    return (
      <Main>
        <div className="bg-white dark:bg-gray-900 rounded-lg p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
          <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-400" />
          <h2 className="text-2xl font-bold mb-2">No Markets Available</h2>
          <p className="text-muted-foreground">
            Configure market addresses in your environment variables
          </p>
        </div>
      </Main>
    );
  }

  return (
    <MarketTradingProvider marketAddress={selectedMarketAddress}>
      <DashboardContent 
        selectedMarket={selectedMarketAddress}
        onMarketChange={setSelectedMarketAddress}
      />
    </MarketTradingProvider>
  );
}