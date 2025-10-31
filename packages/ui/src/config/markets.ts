/**
 * Market address book - configure available trading pairs here
 * Markets are conditionally included based on environment variables
 */

const envMarketCbtcCusdt = import.meta.env.VITE_MARKET_CBTC_CUSDT_ADDRESS as string | undefined;
const envMarketCethCusdt = import.meta.env.VITE_MARKET_CETH_CUSDT_ADDRESS as string | undefined;
const envMarketCgoldCusdt = import.meta.env.VITE_MARKET_CGOLD_CUSDT_ADDRESS as string | undefined;

export type Market = {
  name: string;
  address: string;
  baseSymbol: string;
  quoteSymbol: string;
};

export const MARKET_ADDRESS_BOOK: Market[] = [
  ...(envMarketCbtcCusdt ? [{ 
    name: 'cBTC/cUSDT', 
    address: envMarketCbtcCusdt,
    baseSymbol: 'cBTC',
    quoteSymbol: 'cUSDT'
  }] : []),
  ...(envMarketCethCusdt ? [{ 
    name: 'cETH/cUSDT', 
    address: envMarketCethCusdt,
    baseSymbol: 'cETH',
    quoteSymbol: 'cUSDT'
  }] : []),
  ...(envMarketCgoldCusdt ? [{ 
    name: 'cGOLD/cUSDT', 
    address: envMarketCgoldCusdt,
    baseSymbol: 'cGOLD',
    quoteSymbol: 'cUSDT'
  }] : []),
];

// Get default market (first available)
export const getDefaultMarket = (): Market | null => {
  return MARKET_ADDRESS_BOOK.length > 0 ? MARKET_ADDRESS_BOOK[0] : null;
};

// Find market by address
export const getMarketByAddress = (address: string): Market | undefined => {
  return MARKET_ADDRESS_BOOK.find(m => m.address.toLowerCase() === address.toLowerCase());
};
