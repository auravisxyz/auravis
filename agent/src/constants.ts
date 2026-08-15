import type { Address } from "viem";

/**
 * Token addresses on X Layer mainnet, taken from OKX's own token list
 * (`npm run tokens`) — never guessed.
 *
 * ⚠️ NATIVE vs BRIDGED. X Layer carries both, and they are different
 * contracts with different balances:
 *
 *   USDT          0x779ded0c…   ← native, what OKX Wallet shows as "USDT"
 *   USDT_Bridged  0x1e4a5963…
 *   USDC          0xb6ceceab…   ← native
 *   USDC_Bridged  0x74b7f163…
 *
 * An early guess used the bridged pair. Both are liquid, so every swap quote
 * succeeded and the mistake stayed invisible until a balance check showed the
 * user's 20 USDT as zero. Same symbol, same decimals, different contract —
 * this is the failure mode that hides.
 */
export const TOKENS = {
  USDT: "0x779ded0c9e1022225f8e0630b35a9b54be713736" as Address,
  USDC: "0xb6ceceab302e2e4948951ee7843fc24e92933061" as Address,
  USDG: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8" as Address,
} as const;

export const TOKEN_DECIMALS = 6;
