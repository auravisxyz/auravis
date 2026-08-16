import { formatUnits, type Address, type Hex } from "viem";
import { config } from "./config.js";
import { publicClient } from "./chain.js";
import { TOKENS } from "./constants.js";

/**
 * Print the raw swap response and check who actually holds an allowance.
 *
 * Written to settle one question: when `execute()` fails with the opaque
 * `RouterCallFailed`, is it because we approved the wrong contract? OKX fronts
 * its router with a separate approval proxy, and nothing in the revert says so.
 *
 * Run: npm run diagnose
 */

const BASE = "https://web3.okx.com";
const PATH = "/api/v6/dex/aggregator/swap";

const ERC20 = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

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

async function main() {
  const vault = config.mandateAddress as Address;

  const query = new URLSearchParams({
    chainIndex: "196",
    amount: "10000000",
    fromTokenAddress: TOKENS.USDT,
    toTokenAddress: TOKENS.USDC,
    slippagePercent: "0.5",
    userWalletAddress: vault,
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
    data?: Array<{ tx?: { to?: string; data?: string; signatureData?: string[] } }>;
  };

  const tx = body.data?.[0]?.tx;
  console.log("\n=== what the API returned ===");
  console.log("tx.to (the contract we CALL):", tx?.to);
  console.log("tx.signatureData:", JSON.stringify(tx?.signatureData, null, 2));

  let approveContract: string | undefined;
  for (const entry of tx?.signatureData ?? []) {
    try {
      const parsed = JSON.parse(entry) as { approveContract?: string };
      if (parsed.approveContract) approveContract = parsed.approveContract;
    } catch {
      /* not JSON */
    }
  }

  console.log("\n=== the two addresses ===");
  console.log("call target :", tx?.to);
  console.log("approve to  :", approveContract ?? "(none returned)");
  console.log(
    approveContract && approveContract.toLowerCase() !== tx?.to?.toLowerCase()
      ? "→ THEY DIFFER. Approving the router leaves the puller with no allowance."
      : "→ same address; the failure is something else.",
  );

  // NB: allowance always reads 0 from outside — execute() approves and resets
  // within one transaction. Included only to make that explicit.
  console.log("\n=== allowances (expected 0; approve+reset is atomic) ===");
  for (const [label, spender] of [
    ["router", tx?.to],
    ["approveContract", approveContract],
  ] as const) {
    if (!spender) continue;
    const allowance = (await publicClient.readContract({
      address: TOKENS.USDT,
      abi: ERC20,
      functionName: "allowance",
      args: [vault, spender as Address],
    })) as bigint;
    console.log(`${label.padEnd(16)} ${spender}  allowance ${formatUnits(allowance, 6)}`);
  }

  // Does the vault actually hold what it's about to spend?
  const vaultBal = (await publicClient.readContract({
    address: TOKENS.USDT,
    abi: BALANCE_ABI,
    functionName: "balanceOf",
    args: [vault],
  })) as bigint;
  console.log(`\n=== vault USDT balance: ${formatUnits(vaultBal, 6)} ===`);
  if (vaultBal < 10_000_000n) {
    console.log("→ Vault holds less than the 10 USDT it's trying to spend. That alone");
    console.log("  would make the router's transferFrom fail.");
  }

  /**
   * The decisive test: call the router directly AS the vault.
   *
   * Our contract catches the router's failure and rethrows a bare
   * `RouterCallFailed`, discarding whatever the router actually said. eth_call
   * with `account: vault` replays the same call and surfaces the real reason.
   *
   * Note this runs without our approval in place, so an allowance-related
   * failure here is expected and uninformative — what matters is whether the
   * router complains about something ELSE (a stale route, an unsupported
   * caller, a pool problem), which is the thing we can't otherwise see.
   */
  if (tx?.to && tx.data) {
    console.log("\n=== calling the router directly, as the vault ===");
    try {
      await publicClient.call({
        account: vault,
        to: tx.to as Address,
        data: tx.data as Hex,
      });
      console.log("router call succeeded in simulation (no revert)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(msg.split("\n").slice(0, 12).join("\n"));
    }
  }

  process.exit(0);
}

const BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

main().catch((err) => {
  console.error("diagnose failed:", err);
  process.exit(1);
});
