import { ethers } from "ethers";
import { createFhevmInstance } from "@sealed-exchange/fhevm-sdk";

/**
 * Decrypts an encrypted value (cipher) from FHEVM
 * @param cipherHex - The encrypted value as a hex string
 * @param contractAddress - The contract address that holds the encrypted value
 * @param decimals - Token decimals for formatting the result
 * @param provider - Ethers provider instance
 * @param signer - Ethers signer instance
 * @returns Formatted decrypted value as string, or null if decryption fails
 */
export async function decryptValue(
  cipherHex: string,
  contractAddress: string,
  decimals: number,
  provider: any,
  signer: any
): Promise<string | null> {
  if (!signer || !provider) {
    throw new Error('Wallet not connected');
  }

  if (!cipherHex) {
    return null;
  }

  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      (provider as any).send(method, params ?? [])
  };

  const fhe = await createFhevmInstance({
    provider: eip1193 as any,
    signal: new AbortController().signal,
    mockChains: undefined
  });

  const decryptOne = async (handleHex: string) => {
    if (!handleHex) return null;
    
    const h = handleHex.startsWith('0x') ? handleHex : '0x' + handleHex;
    const kp = (fhe as any).generateKeypair();
    const publicKey = kp.publicKey;
    const privateKey = kp.privateKey;
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 365;
    const eip712 = (fhe as any).createEIP712(
      publicKey,
      [contractAddress],
      startTimestamp,
      durationDays
    );

    let signature: string;
    const signerAddr = await signer.getAddress();

    if ((signer as any)._signTypedData) {
      signature = await (signer as any)._signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );
    } else if ((signer as any).signTypedData) {
      signature = await (signer as any).signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );
    } else {
      throw new Error('Signer does not support typed-data signing');
    }

    const req = [{ handle: h, contractAddress }];
    let lastErr: any = null;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= 3; ++attempt) {
      try {
        const res = await (fhe as any).userDecrypt(
          req,
          privateKey,
          publicKey,
          signature,
          [contractAddress],
          signerAddr,
          startTimestamp,
          durationDays
        );

        if (Array.isArray(res)) return BigInt(res[0]);
        if (res && typeof res === 'object') {
          if (h in res) return BigInt((res as any)[h] as any);
          const vals = Object.values(res);
          if (vals.length > 0) return BigInt(vals[0] as any);
        }
        return null;
      } catch (e: any) {
        lastErr = e;
        const msg = (e && (e.message || e.shortMessage || e?.error?.message) || '').toString();
        const isParseOrder = msg.includes('Parse event') || msg.includes('backward order');
        
        if (!isParseOrder) throw e;
        
        // Wait before retry with exponential backoff
        await new Promise(r => setTimeout(r, 150 * attempt));
      }
    }

    if (lastErr) throw lastErr;
    return null;
  };

  const valueBig = await decryptOne(cipherHex);
  if (valueBig != null) {
    return ethers.formatUnits(valueBig, decimals);
  }
  return null;
}

/**
 * Decrypts multiple values in parallel
 * @param ciphers - Array of cipher objects with hex, contractAddress, and decimals
 * @param provider - Ethers provider instance
 * @param signer - Ethers signer instance
 * @returns Array of decrypted values in the same order
 */
export async function decryptMultipleValues(
  ciphers: Array<{
    cipherHex: string;
    contractAddress: string;
    decimals: number;
  }>,
  provider: any,
  signer: any
): Promise<Array<string | null>> {
  return Promise.all(
    ciphers.map(({ cipherHex, contractAddress, decimals }) =>
      decryptValue(cipherHex, contractAddress, decimals, provider, signer)
    )
  );
}
