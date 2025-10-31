// Centralized helpers to derive UI formatting/input precision per token

const CUSDT_ADDR = (import.meta.env.VITE_TOKEN_CUSDT_ADDRESS || '').toLowerCase();
const CBTC_ADDR = (import.meta.env.VITE_TOKEN_CBTC_ADDRESS || '').toLowerCase();

const CUSDT_MAX = Number(import.meta.env.VITE_TOKEN_CUSDT_MAX_DECIMALS ?? '6');
const CBTC_MAX = Number(import.meta.env.VITE_TOKEN_CBTC_MAX_DECIMALS ?? '8');

/**
 * Get max decimals for formatting and input constraints for a token address.
 * Falls back to provided fallback or 6 when unknown.
 */
export function getTokenMaxDecimalsForAddress(address: string | undefined, fallback?: number): number {
  if (!address) return typeof fallback === 'number' ? fallback : 6;
  const addr = address.toLowerCase();
  if (addr === CUSDT_ADDR) return Number.isFinite(CUSDT_MAX) ? CUSDT_MAX : (typeof fallback === 'number' ? fallback : 6);
  if (addr === CBTC_ADDR) return Number.isFinite(CBTC_MAX) ? CBTC_MAX : (typeof fallback === 'number' ? fallback : 8);
  return typeof fallback === 'number' ? fallback : 6;
}

/** Build an HTML input step string for the given decimals (e.g. 6 -> "0.000001"). */
export function stepFromDecimals(decimals: number): string {
  if (!Number.isFinite(decimals) || decimals <= 0) return '1';
  return `0.${'0'.repeat(Math.max(0, decimals - 1))}1`;
}

/** Format a numeric string with locale using max decimals and a sensible min fraction. */
export function formatAmountLocale(amountStr: string, maxDecimals: number): string {
  const n = Number(amountStr);
  if (!Number.isFinite(n)) return amountStr;
  const minimumFractionDigits = Math.min(2, Math.max(0, maxDecimals));
  const maximumFractionDigits = Math.max(0, maxDecimals);
  return n.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}
