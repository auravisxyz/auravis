import type { Address, Hex } from "viem";
import { config } from "./config.js";

/**
 * OKX DEX aggregator swap client.
 *
 * Verified against the Classic Swap API reference (v6), not guessed:
 *   https://web3.okx.com/onchainos/dev-docs/trade/dex-swap
 *
 * THE KEY DETAIL for our architecture — from the docs, on `userWalletAddress`:
 *
 *   "If you are using your own deployed smart contract to interact with the
 *    OKX DEX Router, please pass your deployed smart contract address"
 *
 * So we pass the AuravisMandate vault address, not the agent's EOA. The
 * aggregator then builds calldata whose caller and recipient is the vault,
 * which is exactly what our `execute()` needs: the vault approves the router,
 * calls it, and measures its own balance delta. Passing the agent's address
 * here would build a swap that pays the agent — which our own price floor
 * would then correctly reject as theft.
 */

const BASE = "https://web3.okx.com";
const SWAP_PATH = "/api/v6/dex/aggregator/swap";

/** X Layer mainnet. The DEX aggregator has no testnet deployment. */
export const X_LAYER_CHAIN_INDEX = "196";

export interface SwapQuoteParams {
  /** Token being sold, in the vault. */
  fromToken: Address;
  /** Token being bought. */
  toToken: Address;
  /** Amount of fromToken, in base units. */
  amount: bigint;
  /** The vault address — NOT the agent. See the note above. */
  vaultAddress: Address;
  /** e.g. "0.5" for 0.5%. */
  slippagePercent?: string;
  chainIndex?: string;
}

export interface SwapQuote {
  /** OKX DEX router — the contract we CALL. */
  router: Address;
  /**
   * The contract that PULLS the tokens, which is NOT the router.
   *
   * OKX fronts its router with a separate token-approval proxy. Approving the
   * router leaves the proxy with no allowance, the internal transferFrom
   * fails, and the whole thing surfaces only as `RouterCallFailed` — no hint
   * that the approval went to the wrong address. Returned by the API in
   * `signatureData.approveContract`; falls back to the router when absent.
   */
  spender: Address;
  /** Calldata to hand to `execute()` as `swapData`. */
  data: Hex;
  /** Native value to send. Should be 0 for ERC-20 → ERC-20. */
  value: bigint;
  /** Aggregator's slippage-adjusted floor, in buyToken base units. */
  minReceiveAmount: bigint;
  /** Expected output before slippage, for display and sanity checks. */
  toTokenAmount: bigint;
  estimateGasFee: bigint;
  priceImpactPercent: string;
}

async function sign(timestamp: string, method: string, pathWithQuery: string): Promise<string> {
  const secret = config.okx.apiSecret;
  if (!secret) throw new Error("OKX_API_SECRET is not configured");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}${method}${pathWithQuery}`),
  );
  return Buffer.from(sig).toString("base64");
}

function authHeaders(timestamp: string, signature: string): Record<string, string> {
  const { apiKey, apiPassphrase, projectId } = config.okx;
  if (!apiKey || !apiPassphrase) throw new Error("OKX API credentials are not configured");

  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": apiPassphrase,
  };
  if (projectId) headers["OK-ACCESS-PROJECT"] = projectId;
  return headers;
}

/**
 * Fetch executable swap calldata. The returned `router` and `data` map
 * directly onto `execute(id, router, swapData, ...)`.
 */
export async function getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  const query = new URLSearchParams({
    chainIndex: params.chainIndex ?? X_LAYER_CHAIN_INDEX,
    amount: params.amount.toString(),
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    slippagePercent: params.slippagePercent ?? "0.5",
    userWalletAddress: params.vaultAddress,
  });

  const pathWithQuery = `${SWAP_PATH}?${query.toString()}`;
  const timestamp = new Date().toISOString();
  const signature = await sign(timestamp, "GET", pathWithQuery);

  const res = await fetch(`${BASE}${pathWithQuery}`, {
    headers: authHeaders(timestamp, signature),
  });

  if (!res.ok) {
    throw new Error(`OKX swap API HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as {
    code: string;
    msg?: string;
    data?: Array<{
      routerResult?: {
        toTokenAmount?: string;
        estimateGasFee?: string;
        priceImpactPercent?: string;
      };
      tx?: {
        to?: string;
        data?: string;
        value?: string;
        minReceiveAmount?: string;
        /** JSON strings; one carries `approveContract`. */
        signatureData?: string[];
      };
    }>;
  };

  if (body.code !== "0") {
    throw new Error(`OKX swap API error ${body.code}: ${body.msg ?? "unknown"}`);
  }

  const entry = body.data?.[0];
  const tx = entry?.tx;
  if (!tx?.to || !tx.data) {
    throw new Error("OKX swap API returned no transaction data");
  }

  // Dig the approval target out of signatureData. Each entry is a JSON string.
  let spender = tx.to as Address;
  for (const entry of tx.signatureData ?? []) {
    try {
      const parsed = JSON.parse(entry) as { approveContract?: string };
      if (parsed.approveContract) {
        spender = parsed.approveContract as Address;
        break;
      }
    } catch {
      // Not JSON, or a different payload shape. Keep looking.
    }
  }

  return {
    router: tx.to as Address,
    spender,
    data: tx.data as Hex,
    value: BigInt(tx.value ?? "0"),
    minReceiveAmount: BigInt(tx.minReceiveAmount ?? "0"),
    toTokenAmount: BigInt(entry?.routerResult?.toTokenAmount ?? "0"),
    estimateGasFee: BigInt(entry?.routerResult?.estimateGasFee ?? "0"),
    priceImpactPercent: entry?.routerResult?.priceImpactPercent ?? "0",
  };
}
