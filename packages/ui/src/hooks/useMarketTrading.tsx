import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { useWalletStore } from '@/stores/wallet-store';
import { createFhevmInstance } from '@sealed-exchange/fhevm-sdk';
import { decryptValue } from '@/lib/fhevm-decrypt';

export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus = 'PENDING' | 'SUBMITTED' | 'SETTLED' | 'CANCELLED';

export type UserOrder = {
  orderId: string;
  batchId: string;
  side: OrderSide;
  tick: number;
  price: string; // human-readable
  amount: string; // human-readable
  status: OrderStatus;
  timestamp: number;
};

export type BatchInfo = {
  currentBatchId: string;
  phase: 'OPEN' | 'FROZEN';
  closeTs: number;
  orderCount: number;
  remainingSeconds: number;
};

export type TickData = {
  index: number;
  price: string; // human-readable (e.g., "60000" USDT per BTC)
  rawPrice: bigint; // scaled price
};

export type MarketInfo = {
  marketAddress: string;
  baseAsset: string;
  quoteAsset: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  maxTicks: number;
  ticks: TickData[];
};

export type MarketTradingContextType = {
  marketInfo: MarketInfo | null;
  batchInfo: BatchInfo | null;
  userOrders: UserOrder[];
  lastPriceDecrypted: string | null;
  isAdmin: boolean;
  loadMarketInfo: () => Promise<void>;
  refreshBatchInfo: () => Promise<void>;
  refreshUserOrders: () => Promise<void>;
  revealClearingPrice: () => Promise<void>;
  clearClearingPrice: () => void;
  submitBuyOrder: (tick: number, amount: string, partialFill: boolean) => Promise<void>;
  submitSellOrder: (tick: number, amount: string, partialFill: boolean) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  finalizeBatch: () => Promise<void>;
  settleBatch: () => Promise<void>;
  openNewBatch: (durationSeconds?: number) => Promise<void>;
  error: { title: string; description: string } | null;
  setError: React.Dispatch<React.SetStateAction<{ title: string; description: string } | null>>;
  isSubmitting: boolean;
  isRevealing: boolean;
  isFinalizing: boolean;
  isSettling: boolean;
  isOpeningBatch: boolean;
};

export const MarketTradingContext = createContext<MarketTradingContextType | null>(null);

export function useMarketTrading() {
  const context = useContext(MarketTradingContext);
  if (!context) {
    throw new Error('useMarketTrading must be used within MarketTradingProvider');
  }
  return context;
}

const marketAbi = [
  'function admin() view returns (address)',
  'function BASE_ASSET() view returns (bytes32)',
  'function QUOTE_ASSET() view returns (bytes32)',
  'function MAX_TICKS() view returns (uint8)',
  'function QSCALE() view returns (uint64)',
  'function BSCALE() view returns (uint64)',
  'function prices(uint256) view returns (uint64)',
  'function priceAt(uint8 tick) view returns (uint64)',
  'function currentBatchId() view returns (uint64)',
  'function phase() view returns (uint8)',
  'function closeTs() view returns (uint64)',
  'function timeUntilClose() view returns (uint64)',
  'function orderCount() view returns (uint256)',
  'function lastPriceEncForCaller() returns (bytes32)',
  'function getMyOrders() view returns ((uint256 orderId,uint64 batchId,uint8 side,uint8 tick,bool partialFill,bool settled,bool cancelled)[])',
  'function submitBuy(uint8 tick, bool partialFill, bytes32 encQuoteAmount, bytes inputProof) returns (uint256 orderId, uint64 batchId)',
  'function submitSell(uint8 tick, bool partialFill, bytes32 encBaseAmount, bytes inputProof) returns (uint256 orderId, uint64 batchId)',
  'function cancelOrder(uint256 orderId)',
  'function finalizeBatch()',
  'function settleBatch()',
  'function openNextBatch(uint64 intakeDuration)',
  'event Submitted(address indexed trader, uint64 batchId, uint8 side, uint8 tick, uint256 orderId)',
  'event Cancelled(address indexed trader, uint64 batchId, uint256 orderId)'
];

const tokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

const vaultAbi = [
  'function getAsset(bytes32) view returns (address token, bool enabled, bool paused, bool isNumeraire)'
];

type MarketTradingProviderProps = {
  children: ReactNode;
  marketAddress: string;
};

export function MarketTradingProvider({ children, marketAddress }: MarketTradingProviderProps) {
  const { provider, signer, account } = useWalletStore();
  const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [userOrders, setUserOrders] = useState<UserOrder[]>([]);
  const [lastPriceDecrypted, setLastPriceDecrypted] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [isOpeningBatch, setIsOpeningBatch] = useState(false);

  // Load market info once on mount
  const loadMarketInfo = useCallback(async () => {
    if (!provider || !marketAddress) return;

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, provider);
      const vaultAddr = import.meta.env.VITE_VAULT_ADDRESS as string;
      const vault = new ethers.Contract(vaultAddr, vaultAbi, provider);

      const [baseAssetId, quoteAssetId, maxTicks, adminAddr] = await Promise.all([
        market.BASE_ASSET(),
        market.QUOTE_ASSET(),
        market.MAX_TICKS(),
        market.admin()
      ]);

      // Check if current account is admin
      if (account && adminAddr) {
        setIsAdmin(adminAddr.toLowerCase() === account.toLowerCase());
      }

      // Get token addresses from vault
      const [baseAssetInfo, quoteAssetInfo] = await Promise.all([
        vault.getAsset(baseAssetId),
        vault.getAsset(quoteAssetId)
      ]);

      const baseTokenAddr = baseAssetInfo[0];
      const quoteTokenAddr = quoteAssetInfo[0];

      // Get token metadata
      const baseToken = new ethers.Contract(baseTokenAddr, tokenAbi, provider);
      const quoteToken = new ethers.Contract(quoteTokenAddr, tokenAbi, provider);

      const [baseSymbol, quoteSymbol, baseDecimals, quoteDecimals] = await Promise.all([
        baseToken.symbol(),
        quoteToken.symbol(),
        baseToken.decimals(),
        quoteToken.decimals()
      ]);

      // Load all tick prices
      const tickCount = Number(maxTicks);
      const tickPromises = [];
      for (let i = 0; i < tickCount; i++) {
        tickPromises.push(market.priceAt(i));
      }
      const rawPrices = await Promise.all(tickPromises);

      const ticks: TickData[] = rawPrices.map((rawPrice, idx) => ({
        index: idx,
        price: ethers.formatUnits(rawPrice, Number(quoteDecimals)),
        rawPrice: BigInt(rawPrice.toString())
      }));

      setMarketInfo({
        marketAddress: marketAddress,
        baseAsset: baseAssetId,
        quoteAsset: quoteAssetId,
        baseSymbol,
        quoteSymbol,
        baseDecimals: Number(baseDecimals),
        quoteDecimals: Number(quoteDecimals),
        maxTicks: tickCount,
        ticks
      });
    } catch (err: any) {
      console.error('Failed to load market info:', err);
      setError({ title: 'Market Load Failed', description: err.message });
    }
  }, [provider, marketAddress]);

  // Refresh batch info periodically
  const refreshBatchInfo = useCallback(async () => {
    if (!provider || !marketAddress) return;

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, provider);
      const [batchId, phase, closeTs, orderCount, remainingFromChain] = await Promise.all([
        market.currentBatchId(),
        market.phase(),
        market.closeTs(),
        market.orderCount(),
        market.timeUntilClose()
      ]);

      const remaining = Number(remainingFromChain);

      setBatchInfo({
        currentBatchId: batchId.toString(),
        phase: Number(phase) === 0 ? 'OPEN' : 'FROZEN',
        closeTs: Number(closeTs),
        orderCount: Number(orderCount),
        remainingSeconds: remaining
      });
    } catch (err: any) {
      console.error('Failed to refresh batch info:', err);
    }
  }, [provider]);

  // Refresh user orders from events
  const refreshUserOrders = useCallback(async () => {
    if (!provider || !account || !marketAddress) return;

    const market = new ethers.Contract(marketAddress, marketAbi, provider);

    // First, try on-chain view helper getMyOrders()
    try {
      const rows: Array<{
        orderId: bigint;
        batchId: bigint;
        side: number;
        tick: number;
        partialFill: boolean;
        settled: boolean;
        cancelled: boolean;
      }> = await market.getMyOrders.staticCall({ from: account });

      const orders: UserOrder[] = rows.map((r) => {
        const tick = Number(r.tick);
        const price = marketInfo?.ticks[tick]?.price || '0';
        let status: OrderStatus = 'SUBMITTED';
        if (r.cancelled) status = 'CANCELLED';
        else if (r.settled) status = 'SETTLED';
        return {
          orderId: r.orderId.toString(),
          batchId: r.batchId.toString(),
          side: Number(r.side) === 0 ? 'BUY' : 'SELL',
          tick,
          price,
          amount: '—',
          status,
          // No timestamps via view; sort by orderId desc instead
          timestamp: 0,
        };
      });

      // Sort newest first by orderId desc
      orders.sort((a, b) => Number(b.orderId) - Number(a.orderId));
      setUserOrders(orders.slice(0, 50));
      return;
    } catch (viewErr) {
      // Fall back to event-based indexing if view not available
      console.debug('getMyOrders view unavailable, falling back to events', viewErr);
    }

    // Fallback: events
    try {
      // Query Submitted events for this user from genesis to latest to avoid missing due to range
      const filter = market.filters.Submitted(account);
      const events = await market.queryFilter(filter, 0, 'latest');

      const orders: UserOrder[] = await Promise.all(
        events.map(async (event: any) => {
          if (!event.args) return null;
          const args = event.args;
          const tick = Number(args.tick);
          const price = marketInfo?.ticks[tick]?.price || '0';
          return {
            orderId: args.orderId.toString(),
            batchId: args.batchId.toString(),
            side: Number(args.side) === 0 ? 'BUY' : 'SELL',
            tick,
            price,
            amount: '—',
            status: 'SUBMITTED' as OrderStatus,
            timestamp: (await event.getBlock()).timestamp,
          };
        })
      ).then((xs) => xs.filter((o): o is UserOrder => o !== null));

      // Apply cancellations
  const cancelFilter = market.filters.Cancelled(account);
  const cancelEvents = await market.queryFilter(cancelFilter, 0, 'latest');
      const cancelledIds = new Set(cancelEvents.map((e: any) => e.args?.orderId?.toString()).filter(Boolean));
      orders.forEach((o) => { if (cancelledIds.has(o.orderId)) o.status = 'CANCELLED'; });

      // Sort by timestamp desc
      orders.sort((a, b) => b.timestamp - a.timestamp);
      setUserOrders(orders.slice(0, 20));
    } catch (err: any) {
      console.error('Failed to refresh user orders:', err);
    }
  }, [provider, account, marketInfo, marketAddress]);

  // Submit buy order
  const submitBuyOrder = useCallback(async (tick: number, amount: string, partialFill: boolean) => {
    if (!signer || !provider || !marketInfo) {
      setError({ title: 'Not Ready', description: 'Connect wallet and wait for market to load' });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Parse amount in quote token
      const rawAmount = ethers.parseUnits(amount, marketInfo.quoteDecimals);
      if (rawAmount <= 0n) throw new Error('Amount must be > 0');

      // Initialize FHE SDK
      const eip1193 = {
        request: async ({ method, params }: { method: string; params?: any[] }) =>
          provider.send(method, params ?? [])
      };
      const fhe = await createFhevmInstance({
        provider: eip1193 as any,
        signal: new AbortController().signal
      });

      // Encrypt amount for market contract
      const enc = await (fhe as any)
        .createEncryptedInput(marketAddress, await signer.getAddress())
        .add64(rawAmount)
        .encrypt();

      if (!enc?.handles?.length) throw new Error('Encryption failed');

      const handleHex = ethers.hexlify(enc.handles[0]) as `0x${string}`;
      const inputProof = enc.inputProof as `0x${string}`;

      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.submitBuy(tick, partialFill, handleHex, inputProof);
      await tx.wait();

      // Refresh
      await Promise.all([refreshBatchInfo(), refreshUserOrders()]);
    } catch (err: any) {
      console.error('Buy order failed:', err);
      setError({ title: 'Buy Failed', description: err.message || 'Could not submit buy order' });
    } finally {
      setIsSubmitting(false);
    }
  }, [signer, provider, marketInfo, refreshBatchInfo, refreshUserOrders]);

  // Submit sell order
  const submitSellOrder = useCallback(async (tick: number, amount: string, partialFill: boolean) => {
    if (!signer || !provider || !marketInfo) {
      setError({ title: 'Not Ready', description: 'Connect wallet and wait for market to load' });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Parse amount in base token
      const rawAmount = ethers.parseUnits(amount, marketInfo.baseDecimals);
      if (rawAmount <= 0n) throw new Error('Amount must be > 0');

      // Initialize FHE SDK
      const eip1193 = {
        request: async ({ method, params }: { method: string; params?: any[] }) =>
          provider.send(method, params ?? [])
      };
      const fhe = await createFhevmInstance({
        provider: eip1193 as any,
        signal: new AbortController().signal
      });

      // Encrypt amount for market contract
      const enc = await (fhe as any)
        .createEncryptedInput(marketAddress, await signer.getAddress())
        .add64(rawAmount)
        .encrypt();

      if (!enc?.handles?.length) throw new Error('Encryption failed');

      const handleHex = ethers.hexlify(enc.handles[0]) as `0x${string}`;
      const inputProof = enc.inputProof as `0x${string}`;

      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.submitSell(tick, partialFill, handleHex, inputProof);
      await tx.wait();

      // Refresh
      await Promise.all([refreshBatchInfo(), refreshUserOrders()]);
    } catch (err: any) {
      console.error('Sell order failed:', err);
      setError({ title: 'Sell Failed', description: err.message || 'Could not submit sell order' });
    } finally {
      setIsSubmitting(false);
    }
  }, [signer, provider, marketInfo, refreshBatchInfo, refreshUserOrders]);

  // Clear/hide the decrypted clearing price
  const clearClearingPrice = useCallback(() => {
    setLastPriceDecrypted(null);
  }, []);

  // Reveal clearing price: fetch encrypted handle and decrypt it
  const revealClearingPrice = useCallback(async () => {
    if (!provider || !signer || !account || !marketAddress || !marketInfo) return;

    setIsRevealing(true);
    setError(null);

    try {
      // Step 1: Transaction to grant read access for caller, then wait
      const marketWrite = new ethers.Contract(marketAddress, marketAbi, signer);
      const grantTx = await marketWrite.lastPriceEncForCaller();
      await grantTx.wait();

      // Step 2: Static call from caller to fetch ciphertext handle
      const marketRead = new ethers.Contract(marketAddress, marketAbi, provider);
      const ePrice = await marketRead.lastPriceEncForCaller.staticCall({ from: account });
      const handleHex = ethers.hexlify(ePrice) as `0x${string}`;

      // Step 3: Decrypt with shared helper (ephemeral key + EIP712)
      const priceStr = await decryptValue(handleHex, marketAddress, marketInfo.quoteDecimals, provider as any, signer as any);
      if (!priceStr) throw new Error('Decryption returned empty result');
      setLastPriceDecrypted(priceStr);
    } catch (err: any) {
      console.error('Failed to reveal clearing price:', err);
      setError({ title: 'Reveal Failed', description: err.message || 'Could not reveal clearing price' });
    } finally {
      setIsRevealing(false);
    }
  }, [provider, signer, account, marketInfo]);

  // Cancel order
  const cancelOrder = useCallback(async (orderId: string) => {
    if (!signer) {
      setError({ title: 'Not Connected', description: 'Connect wallet to cancel orders' });
      return;
    }

    setError(null);

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.cancelOrder(orderId);
      await tx.wait();

      // Refresh
      await refreshUserOrders();
    } catch (err: any) {
      console.error('Cancel failed:', err);
      setError({ title: 'Cancel Failed', description: err.message || 'Could not cancel order' });
    }
  }, [signer, refreshUserOrders]);

  // Finalize batch (any user can call)
  const finalizeBatch = useCallback(async () => {
    if (!signer) {
      setError({ title: 'Not Connected', description: 'Connect wallet to finalize batch' });
      return;
    }

    setIsFinalizing(true);
    setError(null);

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.finalizeBatch();
      await tx.wait();

      // Refresh batch info
      await refreshBatchInfo();
    } catch (err: any) {
      console.error('Finalize failed:', err);
      setError({ title: 'Finalize Failed', description: err.message || 'Could not finalize batch' });
    } finally {
      setIsFinalizing(false);
    }
  }, [signer, refreshBatchInfo]);

  // Settle batch (any user can call)
  const settleBatch = useCallback(async () => {
    if (!signer) {
      setError({ title: 'Not Connected', description: 'Connect wallet to settle batch' });
      return;
    }

    setIsSettling(true);
    setError(null);

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.settleBatch();
      await tx.wait();

      // Refresh batch info and user orders
      await Promise.all([refreshBatchInfo(), refreshUserOrders()]);
    } catch (err: any) {
      console.error('Settle failed:', err);
      setError({ title: 'Settle Failed', description: err.message || 'Could not settle batch' });
    } finally {
      setIsSettling(false);
    }
  }, [signer, refreshBatchInfo, refreshUserOrders]);

  // Open new batch (admin only)
  const openNewBatch = useCallback(async (durationSeconds: number = 60) => {
    if (!signer) {
      setError({ title: 'Not Connected', description: 'Connect wallet to open batch' });
      return;
    }

    if (!isAdmin) {
      setError({ title: 'Not Authorized', description: 'Only admin can open new batches' });
      return;
    }

    setIsOpeningBatch(true);
    setError(null);

    try {
      const market = new ethers.Contract(marketAddress, marketAbi, signer);
      const tx = await market.openNextBatch(durationSeconds);
      await tx.wait();

      // Refresh batch info
      await refreshBatchInfo();
    } catch (err: any) {
      console.error('Open batch failed:', err);
      setError({ title: 'Open Batch Failed', description: err.message || 'Could not open new batch' });
    } finally {
      setIsOpeningBatch(false);
    }
  }, [signer, isAdmin, refreshBatchInfo]);

  // Load market info on mount
  useEffect(() => {
    if (provider && marketAddress) {
      loadMarketInfo();
    }
  }, [provider, loadMarketInfo]);

  // Refresh batch info every 5s
  useEffect(() => {
    if (!provider || !marketAddress) return;

    refreshBatchInfo();
    const interval = setInterval(refreshBatchInfo, 5000);
    return () => clearInterval(interval);
  }, [provider, refreshBatchInfo]);

  // Refresh user orders when account/marketInfo changes
  useEffect(() => {
    if (account && marketInfo) {
      refreshUserOrders();
    }
  }, [account, marketInfo, refreshUserOrders]);

  return (
    <MarketTradingContext.Provider
      value={{
        marketInfo,
        batchInfo,
        userOrders,
        lastPriceDecrypted,
        isAdmin,
        loadMarketInfo,
        refreshBatchInfo,
        refreshUserOrders,
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
      }}
    >
      {children}
    </MarketTradingContext.Provider>
  );
}
