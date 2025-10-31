function isLocalHost(hostname: string | undefined): boolean {
  if (!hostname) return false;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return true;
  }
  // Common private IPv4 ranges used in local networks
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname))
    return true;
  // Bonjour/mDNS style local domains
  if (hostname.endsWith(".local")) return true;
  return false;
}

// Single source of truth for the SDK script URL.
// - Local/dev: use the official CDN (works without rewrites)
// - Hosted (e.g., Vercel): use same-origin via /relayer (rewritten to the CDN)
export const SDK_CDN_URL =
  typeof window !== "undefined" && isLocalHost(window.location.hostname)
    ? "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs"
    : "/relayer/relayer-sdk-js.umd.cjs";
// export const SDK_CDN_URL =
//   "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs";
