import { createWalletClient, http, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";
import { TOKENS } from "./constants.js";

/**
 * One-shot: swap the owner's USDT → USDC via OKX, then forward the USDC to
 * the DemoRouter as its payout reserve. Replaces clicking through the wallet.
 *
 *   npm run owner:swap               # dry run — quote only
 *   npm run owner:swap -- --confirm  # approve → swap → fund router
 *
 * Side benefit: the owner is an EOA. This succeeding is the control run that
 * proves the OKX router's contract-caller rejection is exactly that — the
 * same router, same pair, same day, working for an EOA.
 */

const CONFIRM = process.argv.includes("--confirm");
const AMOUNT = 1_000_000n; // 1 USDT (reduced for diagnostic)

const ERC20 = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
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
  if (!config.ownerPrivateKey) {
    console.error("OWNER_PRIVATE_KEY not set.");
    process.exit(1);
  }
  if (!config.demoRouter) {
    console.error("DEMO_ROUTER_MAINNET not set.");
    process.exit(1);
  }

  const owner = privateKeyToAccount(config.ownerPrivateKey);
  const wallet = createWalletClient({
    account: owner,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  console.log(CONFIRM ? "OWNER SWAP — LIVE\n" : "OWNER SWAP — DRY RUN\n");
  console.log(`owner:  ${owner.address}`);
  console.log(`amount: ${formatUnits(AMOUNT, 6)} USDT → USDC`);
  console.log(`reserve destination: ${config.demoRouter}\n`);

  async function getSwapQuote() {
    const query = new URLSearchParams({
      chainIndex: "196",
      amount: AMOUNT.toString(),
      fromTokenAddress: TOKENS.USDT,
      toTokenAddress: TOKENS.USDC,
      slippagePercent: "0.5",
      userWalletAddress: owner.address,
    });
    const p = `/api/v6/dex/aggregator/swap?${query.toString()}`;
    const ts = new Date().toISOString();
    const hdrs: Record<string, string> = {
      "OK-ACCESS-KEY": config.okx.apiKey ?? "",
      "OK-ACCESS-SIGN": await sign(ts, "GET", p),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": config.okx.apiPassphrase ?? "",
    };
    if (config.okx.projectId) hdrs["OK-ACCESS-PROJECT"] = config.okx.projectId;

    const r = await fetch(`https://web3.okx.com${p}`, { headers: hdrs });
    const b = (await r.json()) as {
      code: string;
      msg?: string;
      data?: Array<{
        tx?: { to?: string; data?: string; value?: string; minReceiveAmount?: string; signatureData?: string[] };
      }>;
    };
    if (b.code !== "0") {
      console.error(`quote failed: ${b.code} ${b.msg ?? ""}`);
      process.exit(1);
    }
    const swapTx = b.data?.[0]?.tx;
    if (!swapTx?.to || !swapTx.data) {
      console.error("no transaction in quote");
      process.exit(1);
    }
    let approve = swapTx.to as Address;
    for (const entry of swapTx.signatureData ?? []) {
      try {
        const parsed = JSON.parse(entry) as { approveContract?: string };
        if (parsed.approveContract) approve = parsed.approveContract as Address;
      } catch { /* not JSON */ }
    }
    return { tx: swapTx, approveTo: approve };
  }

  const initial = await getSwapQuote();
  console.log(`router:     ${initial.tx.to}`);
  console.log(`approve to: ${initial.approveTo}`);
  console.log(`min out:    ${formatUnits(BigInt(initial.tx.minReceiveAmount ?? "0"), 6)} USDC`);

  if (!CONFIRM) {
    console.log("\nDry run finished. Re-run with --confirm to swap and fund the router.");
    process.exit(0);
  }

  const usdcBefore = (await publicClient.readContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "balanceOf",
    args: [owner.address],
  })) as bigint;

  console.log("\n[1/3] approving…");
  const approveHash = await wallet.writeContract({
    address: TOKENS.USDT,
    abi: ERC20,
    functionName: "approve",
    args: [initial.approveTo, 2n ** 256n - 1n],
    chain: activeChain,
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Re-quote after approval so the calldata is fresh — the original quote
  // goes stale during the ~15s approval confirmation window.
  console.log("[2/3] swapping (fresh quote)…");
  const fresh = await getSwapQuote();
  // A manual gas limit skips viem's pre-flight estimateGas call, which
  // itself reverts (that's the bug) and would otherwise stop the tx from
  // ever being broadcast. This forces it onto the chain for a real,
  // minable revert receipt — the evidence the OKX ticket needs.
  const swapHash = await wallet.sendTransaction({
    to: fresh.tx.to as Address,
    data: fresh.tx.data as Hex,
    value: BigInt(fresh.tx.value ?? "0"),
    gas: 500_000n,
    chain: activeChain,
    account: owner,
  });
  console.log(`      broadcast: ${swapHash}`);
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (swapReceipt.status !== "success") {
    console.error(`swap reverted: ${swapHash}`);
    process.exit(1);
  }

  const usdcAfter = (await publicClient.readContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "balanceOf",
    args: [owner.address],
  })) as bigint;
  const received = usdcAfter - usdcBefore;
  console.log(`      received ${formatUnits(received, 6)} USDC (tx ${swapHash})`);
  console.log("      → EOA swap works. The router's rejection is contract-callers only.");

  console.log("[3/3] funding the DemoRouter reserve…");
  const fundHash = await wallet.writeContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "transfer",
    args: [config.demoRouter, received],
    chain: activeChain,
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  console.log(`\nDone. Router reserve funded with ${formatUnits(received, 6)} USDC.`);
  console.log(`Next: allowlist the router, then npm run execute:mainnet`);
  process.exit(0);
}

main().catch((err) => {
  console.error("owner-swap failed:", err);
  process.exit(1);
});
