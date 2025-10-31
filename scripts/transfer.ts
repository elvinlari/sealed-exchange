import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { createFhevmInstance } from '@fhevm-sdk';

// Simple helper: scale human amount to raw uint64 according to decimals
const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string, decimals: number) => {
  const raw = ethers.parseUnits(human, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};

async function initFhevm({ provider, wallet }: { provider: JsonRpcProvider; wallet: ethers.Wallet }) {
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      return provider.send(method, params ?? []);
    },
  };

  const controller = new AbortController();

  const instance = await createFhevmInstance({ provider: eip1193, signal: controller.signal, mockChains: undefined });

  if ('setSigner' in instance && typeof (instance as any).setSigner === 'function') {
    (instance as any).setSigner({
      getAddress: async () => wallet.address,
      signMessage: (msg: string | Uint8Array) => wallet.signMessage(msg as any),
    });
  }

  return instance;
}

async function main() {
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3') as `0x${string}`;

  // recipient and amount can be passed via env or CLI args
  const recipientArg = process.argv[2] || process.env.RECIPIENT || '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
  const amountArg = process.argv[3] || process.env.AMOUNT || '1'; // human amount (e.g., "1.5")

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Minimal ABI for the transfer overload that accepts an external ciphertext handle + proof
  const abi = [
    'function decimals() view returns (uint8)',
    'function transfer(address to, bytes32 encAmount, bytes calldata inputProof) returns (bool)',
  ];

  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

  const decimals = Number(await token.decimals());

  const rawAmount = toRawAmount(amountArg, decimals);
  console.log(`Sending ${amountArg} tokens (raw=${rawAmount}) from ${wallet.address} to ${recipientArg} on ${TOKEN_ADDRESS}`);

  // Initialize fhevm SDK
  const fhe = await initFhevm({ provider, wallet });

  // Build encrypted input (externalEuint64) for the amount
  const enc = await (fhe as any).createEncryptedInput(TOKEN_ADDRESS, wallet.address).add64(rawAmount).encrypt();

  if (!enc || !enc.handles || enc.handles.length === 0) {
    throw new Error('Encryption failed: no handles returned');
  }

  const handle = enc.handles[0];
  const inputProof = enc.inputProof;

  console.log('Encrypted handle:', handle);

  const tx = await token.transfer(recipientArg, handle, inputProof);
  console.log('tx hash:', tx.hash);
  const rcpt = await tx.wait();
  console.log('Transfer completed, tx receipt:', rcpt.transactionHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
