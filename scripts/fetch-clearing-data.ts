import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
  MARKET_CBTC_CUSDT_ADDRESS: `0x${string}`;
}

async function initFhevm(provider: JsonRpcProvider) {
  const eip1193 = { request: async ({ method, params }: { method: string; params?: any[] }) => provider.send(method, params ?? []) };
  const controller = new AbortController();
  const inst: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });
  return inst as any;
}

async function decryptEuint64(
  fhe: any,
  ciphertextBytes32: string,
  signer: ethers.Wallet,
  contractAddress: `0x${string}`
): Promise<bigint> {
  if (!ciphertextBytes32 || ciphertextBytes32 === '0x') return 0n;
  if (typeof fhe.userDecrypt !== 'function') throw new Error('fhEVM SDK userDecrypt not found. Please update @fhevm-sdk.');

  const kp = (fhe as any).generateKeypair();
  const publicKey = kp.publicKey;
  const privateKey = kp.privateKey;

  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;

  const eip712 = (fhe as any).createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

  let signature: string;
  const signerAny: any = signer as any;
  if (typeof signerAny.signTypedData === 'function') {
    signature = await signerAny.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else if (typeof signerAny._signTypedData === 'function') {
    signature = await signerAny._signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else {
    throw new Error('Signer does not support typed-data signing');
  }

  const req = [{ handle: ciphertextBytes32, contractAddress }];

  // Retry transient relayer ordering errors
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await (fhe as any).userDecrypt(
        req,
        privateKey,
        publicKey,
        signature,
        [contractAddress],
        await signer.getAddress(),
        startTimestamp,
        durationDays
      );
      if (Array.isArray(res) && res.length > 0) return BigInt(res[0]);
      if (res && typeof res === 'object') {
        if (ciphertextBytes32 in res) return BigInt((res as any)[ciphertextBytes32] as any);
        const vals = Object.values(res);
        if (vals.length > 0) return BigInt(vals[0] as any);
      }
      throw new Error('userDecrypt returned unexpected result');
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || e?.shortMessage || e?.error?.message || '').toString();
      const parseOrder = msg.includes('Parse event') || msg.includes('backward order');
      if (!parseOrder || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  // If decryption fails, treat as zero per spec
  return 0n;
}

function zeroish(v: string | null | undefined) {
  return !v || v === '0x' || /^0x0+$/i.test(v);
}

async function main() {
  const ROOT = process.cwd();
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const RPC_URL = (getArg('rpc') ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545');
  const pk = (getArg('pk') ?? process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`;

  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  const fhe = await initFhevm(provider);

  const marketAddr = (getArg('market') as `0x${string}` | undefined) ?? contracts.MARKET_CBTC_CUSDT_ADDRESS;

  const marketAbi = [
    'function admin() view returns (address)',
    'function phase() view returns (uint8)',
    'function currentBatchId() view returns (uint64)',
    'function closeTs() view returns (uint64)',
    'function QSCALE() view returns (uint64)',
    'function BSCALE() view returns (uint64)',
    'function MAX_TICKS() view returns (uint8)',
    'function priceAt(uint8 tick) view returns (uint64)',
    'function lastTickEncForCaller() returns (bytes32)',
    'function lastPriceEncForCaller() returns (bytes32)',
    'function lastMatchedVolForCaller() returns (bytes32)'
  ];

  const ercConfAbi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ];

  // Token decimals for formatting
  const baseToken = new ethers.Contract(contracts.TOKEN_CBTC_ADDRESS, ercConfAbi, provider);
  const quoteToken = new ethers.Contract(contracts.TOKEN_CUSDT_ADDRESS, ercConfAbi, provider);
  const [baseSymbol, baseDecimals, quoteSymbol, quoteDecimals] = await Promise.all([
    baseToken.symbol(),
    baseToken.decimals(),
    quoteToken.symbol(),
    quoteToken.decimals(),
  ]);

  const market = new ethers.Contract(marketAddr, marketAbi, wallet);

  // Read batch status
  const [phase, batchId, closeTs, qscale, bscale, adminAddr] = await Promise.all([
    market.phase(),
    market.currentBatchId(),
    market.closeTs(),
    market.QSCALE(),
    market.BSCALE(),
    market.admin(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const remain = Number(closeTs) - now;
  const phaseStr = Number(phase) === 0 ? 'OPEN' : 'FROZEN';
  console.log(`Market ${marketAddr}`);
  console.log(`  Phase=${phaseStr}, currentBatchId=${batchId}`);
  console.log(`  Window closes at ${closeTs} (in ~${Math.max(remain, 0)}s)`);
  console.log(`  QSCALE=${qscale} (10^${quoteDecimals}), BSCALE=${bscale} (10^${baseDecimals})`);

  // 1) Grant decryption for clearing tick and price (and matched volume if admin)
  try {
    const tx1 = await market.lastTickEncForCaller();
    await tx1.wait();
  } catch {}
  try {
    const tx2 = await market.lastPriceEncForCaller();
    await tx2.wait();
  } catch {}

  let canGetMatched = false;
  if (String(adminAddr).toLowerCase() === wallet.address.toLowerCase()) {
    try {
      const tx3 = await market.lastMatchedVolForCaller();
      await tx3.wait();
      canGetMatched = true;
    } catch {
      // ignore
    }
  }

  // 2) Re-read ciphertexts via staticCall
  let eTick: string | null = null;
  let ePrice: string | null = null;
  let eMatched: string | null = null;
  try {
    eTick = await market.lastTickEncForCaller.staticCall({ from: wallet.address });
  } catch {}
  try {
    ePrice = await market.lastPriceEncForCaller.staticCall({ from: wallet.address });
  } catch {}
  if (canGetMatched) {
    try {
      eMatched = await market.lastMatchedVolForCaller.staticCall({ from: wallet.address });
    } catch {}
  }

  // 3) Decrypt
  let clearingTick = 0n;
  let clearingPriceScaled = 0n;
  let matchedVolBaseRaw = 0n;

  if (eTick && !zeroish(eTick)) {
    const hex = ethers.hexlify(eTick) as `0x${string}`;
    clearingTick = await decryptEuint64(fhe, hex, wallet, marketAddr);
  }
  if (ePrice && !zeroish(ePrice)) {
    const hex = ethers.hexlify(ePrice) as `0x${string}`;
    clearingPriceScaled = await decryptEuint64(fhe, hex, wallet, marketAddr);
  }
  if (eMatched && !zeroish(eMatched)) {
    const hex = ethers.hexlify(eMatched) as `0x${string}`;
    matchedVolBaseRaw = await decryptEuint64(fhe, hex, wallet, marketAddr);
  }

  // 4) Pretty print
  const tickNum = Number(clearingTick);
  const priceHuman = ethers.formatUnits(clearingPriceScaled, Number(quoteDecimals));
  const matchedHuman = ethers.formatUnits(matchedVolBaseRaw, Number(baseDecimals));

  console.log('\nClearing data (previous finalized batch):');
  console.log(`  clearingTick: ${tickNum}`);
  console.log(`  clearingPrice: ${priceHuman} ${String(quoteSymbol)}/${String(baseSymbol)} (scaled=${clearingPriceScaled})`);
  if (canGetMatched) {
    console.log(`  matchedVolume: ${matchedHuman} ${String(baseSymbol)} (raw=${matchedVolBaseRaw})`);
  } else {
    console.log('  matchedVolume: <admin only>');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
