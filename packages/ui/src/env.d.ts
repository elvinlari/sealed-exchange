/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VAULT_ADDRESS: string;
  readonly VITE_TOKEN_CUSDT_ADDRESS: string;
  readonly VITE_TOKEN_CBTC_ADDRESS: string;
  readonly VITE_RPC_URL: string;
  readonly VITE_MARKET_CBTC_CUSDT_ADDRESS: string;
  readonly VITE_MARKET_CETH_CUSDT_ADDRESS?: string;
  readonly VITE_MARKET_CGOLD_CUSDT_ADDRESS?: string;
  readonly VITE_TOKEN_CUSDT_MAX_DECIMALS: string; 
  readonly VITE_TOKEN_CBTC_MAX_DECIMALS: string; 
  readonly VITE_TOKEN_CGOLD_MAX_DECIMALS?: string; 
  readonly VITE_TOKEN_CETH_MAX_DECIMALS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
