import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";

/**
 * The demo's lever. DemoRouter fills at `rateBps / 10_000`, so lowering it
 * below a mandate's price floor makes the vault refuse the next execute() on
 * mainnet, with real money.
 *
 *   npm run set:rate                        # show the current rate
 *   npm run set:rate -- 9000 --confirm      # offer 0.90 per 1.00 (below a 0.99 floor)
 *   npm run set:rate -- 9990 --confirm      # put it back to a fair rate
 *
 * Owner-only on the contract, so this needs DEPLOYER_PRIVATE_KEY. That is
 * deliberate: if the agent could move the rate, it could talk its own floor
 * down, which is the exact attack the floor exists to stop.
 */

const CONFIRM = process.argv.includes("--confirm");

const ROUTER_ABI = [
  {
    type: "function",
    name: "rateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setRateBps",
    stateMutability: "nonpayable",
    inputs: [{ name: "_rateBps", type: "uint256" }],
    outputs: [],
  },
] as const;

/** First bare numeric argument, e.g. `-- 9000 --confirm`. */
function requestedRate(): bigint | null {
  for (const arg of process.argv.slice(2)) {
    if (/^\d+$/.test(arg)) return BigInt(arg);
  }
  return null;
}

function describe(bps: bigint): string {
  return `${bps} bps (pays ${(Number(bps) / 10_000).toFixed(4)} out per 1.0000 in)`;
}

async function main() {
  if (!config.demoRouter) {
    console.error("DEMO_ROUTER_MAINNET not set.");
    process.exit(1);
  }

  const router = config.demoRouter as Address;
  const current = (await publicClient.readContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: "rateBps",
  })) as bigint;

  console.log(`router  ${router}`);
  console.log(`current ${describe(current)}`);

  const next = requestedRate();
  if (next === null) {
    console.log("\nPass a rate to change it, e.g. `npm run set:rate -- 9000 --confirm`.");
    process.exit(0);
  }

  console.log(`next    ${describe(next)}`);
  if (next < current) {
    console.log("\nThis lowers the payout. If it lands under a mandate's floor,");
    console.log("the vault will refuse the next execute() on-chain.");
  }

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --confirm to send it.");
    process.exit(0);
  }

  if (!config.deployerPrivateKey) {
    console.error("\nDEPLOYER_PRIVATE_KEY not set. Only DemoRouter's owner can set the rate.");
    process.exit(1);
  }

  const deployer = privateKeyToAccount(config.deployerPrivateKey);
  const wallet = createWalletClient({
    account: deployer,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  const hash = await wallet.writeContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: "setRateBps",
    args: [next],
    chain: activeChain,
    account: deployer,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`\nRate set. tx ${hash}  status: ${receipt.status}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("set-rate failed:", err);
  process.exit(1);
});
