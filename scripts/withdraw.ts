// scripts/withdraw.ts
import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { createFhevmInstance } from '@fhevm-sdk';

const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string, decimals: number) => {
  const raw = ethers.parseUnits(human, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};

async function main() {
  // --- env ---
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const PRIVATE_KEY =
    process.env.PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const VAULT_ADDRESS = (process.env.VAULT_ADDRESS ??
    '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as `0x${string}`;

  const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ??
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as `0x${string}`;

  const ASSET_ID = (process.env.ASSET_ID ??
    '0xddebacb692a0487118feab5c664e2c8352d57b33c877cbf8b68294bdcb9ac964') as `0x${string}`;

  const AMOUNT = process.argv[2] || process.env.AMOUNT || '1';

  // --- provider/signer ---
  const provider: JsonRpcProvider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // --- ABIs & contracts ---
  const vaultAbi = [
    'function withdraw(bytes32 assetId, bytes32 encAmount, bytes inputProof) external',
  ];
  const erc20Abi = ['function decimals() view returns (uint8)', 'function name() view returns (string)'];

  const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, wallet);
  const token = new ethers.Contract(TOKEN_ADDRESS, erc20Abi, provider);

  // --- token metadata for scaling/logs ---
  const [name, decimals] = await Promise.all([token.name(), token.decimals()]);
  const raw = toRawAmount(AMOUNT, Number(decimals));

  console.log(`Withdraw (user -> Vault flow)`);
  console.log(`  token = ${TOKEN_ADDRESS} (${name})`);
  console.log(`  vault = ${VAULT_ADDRESS}`);
  console.log(`  asset = ${ASSET_ID}`);
  console.log(`  user  = ${wallet.address}`);
  console.log(`  amount= ${AMOUNT} (raw=${raw})`);

  // --- init fhEVM SDK ---
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      provider.send(method, params ?? []),
  };
  const controller = new AbortController();
  const fhe: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });

  if (typeof fhe.setSigner === 'function') {
    fhe.setSigner({
      getAddress: async () => wallet.address,
      signMessage: (msg: string | Uint8Array) => wallet.signMessage(msg as any),
    });
  }

  // --- Build encrypted input FOR THE VAULT (critical!) ---
  
  const enc = await fhe.createEncryptedInput(VAULT_ADDRESS, wallet.address).add64(raw).encrypt();
  if (!enc?.handles?.length) throw new Error('encryption failed');

  const encHandle = ethers.hexlify(enc.handles[0]) as `0x${string}`;
  const inputProof = ethers.hexlify(enc.inputProof) as `0x${string}`;

  // --- call withdraw ---
  const tx = await vault.withdraw(ASSET_ID, encHandle, inputProof);
  console.log('tx hash:', tx.hash);
  const rcpt = await tx.wait();
  console.log('✅ Withdraw completed, tx:', rcpt?.hash ?? rcpt?.transactionHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
