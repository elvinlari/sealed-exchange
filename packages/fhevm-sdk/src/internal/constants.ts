// Choose CDN in local dev (to match working local behavior) and a same-origin proxied path in hosted envs to avoid CORS.
export const SDK_CDN_URL =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
    ? "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs"
    : "/relayer/relayer-sdk-js.umd.cjs";
