import { formatUnits, type Address } from "viem";
import { config } from "./config.js";
import { publicClient } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { agentAccount } from "./chain.js";
import { TOKENS } from "./constants.js";

/**
 * Try several route shapes and simulate execute() against each.
 *
 * `RouterCallFailed` tells us the router refused but not why. Rather than keep
 * guessing, ask the aggregator for progressively simpler routes and see which
 * (if any) our vault can actually execute. A single-pool route succeeding
 * would mean the problem is multi-hop calldata, not contract callers.
 *
 * Simulation only — nothing is sent.
 *
 * Run: npm run routes
 */

const BASE = "https://web3.okx.com";
const PATH = "/api/v6/dex/aggregator/swap";

const VARIANTS: Array<{ label: string; params: Record<string, string> }> = [
  { label: "default (what failed)", params: {} },
  { label: "singleRouteOnly", params: { singleRouteOnly: "true" } },
  { label: "singlePoolPerHop", params: { singlePoolPerHop: "true" } },
  { label: "directRoute", params: { directRoute: "true" } },
  { label: "no RFQ sources", params: { disableRFQ: "true" } },
  { label: "single + no RFQ", params: { singleRouteOnly: "true", disableRFQ: "true" } },
  { label: "USDT → USDG instead", params: {}, },
];

async function sign(timestamp: string, method: string, path: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.okx.apiSecret ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}${method}${path}`),
  );
  return Buffer.from(sig).toString("base64");
}

async function quote(
  extra: Record<string, string>,
  toToken: Address,
): Promise<{ to: string; data: string; minOut: string } | null> {
  const vault = config.mandateAddress as Address;
  const query = new URLSearchParams({
    chainIndex: "196",
    amount: "10000000",
    fromTokenAddress: TOKENS.USDT,
    toTokenAddress: toToken,
    slippagePercent: "0.5",
    userWalletAddress: vault,
    ...extra,
  });
  const path = `${PATH}?${query.toString()}`;
  const timestamp = new Date().toISOString();

  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": config.okx.apiKey ?? "",
    "OK-ACCESS-SIGN": await sign(timestamp, "GET", path),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": config.okx.apiPassphrase ?? "",
  };
  if (config.okx.projectId) headers["OK-ACCESS-PROJECT"] = config.okx.projectId;

  const res = await fetch(`${BASE}${path}`, { headers });
  const body = (await res.json()) as {
    code: string;
    msg?: string;
    data?: Array<{ tx?: { to?: string; data?: string; minReceiveAmount?: string } }>;
  };
  if (body.code !== "0") {
    console.log(`    quote failed: ${body.code} ${body.msg ?? ""}`);
    return null;
  }
  const tx = body.data?.[0]?.tx;
  if (!tx?.to || !tx.data) return null;
  return { to: tx.to, data: tx.data, minOut: tx.minReceiveAmount ?? "0" };
}

async function main() {
  const vault = config.mandateAddress as Address;
  console.log(`vault ${vault}\nagent ${agentAccount.address}\n`);

  for (const variant of VARIANTS) {
    const toToken = variant.label.includes("USDG") ? TOKENS.USDG : TOKENS.USDC;
    console.log(`── ${variant.label}`);

    const q = await quote(variant.params, toToken);
    if (!q) {
      console.log("    no route\n");
      continue;
    }
    console.log(`    router ${q.to}, minOut ${formatUnits(BigInt(q.minOut), 6)}`);

    try {
      await publicClient.simulateContract({
        address: vault,
        abi: auravisMandateAbi,
        functionName: "execute",
        args: [0n, q.to as Address, q.data as `0x${string}`, 10_000_000n, BigInt(q.minOut), "probe"],
        account: agentAccount,
      });
      console.log("    ✅ SIMULATION PASSED — this route works\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const named = msg.match(/Error: (\w+)\(/)?.[1] ?? "reverted";
      console.log(`    ✗ ${named}\n`);
    }
  }

  console.log(
    "A passing route means the failure was route-specific, not architectural —\n" +
      "pin those params in swap.ts and move on.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("routes failed:", err);
  process.exit(1);
});
