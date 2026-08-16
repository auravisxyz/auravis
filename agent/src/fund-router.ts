import { createWalletClient, http, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";
import { TOKENS } from "./constants.js";

/**
 * Move the owner's USDC into the DemoRouter's payout reserve. Plain ERC-20
 * transfer — no aggregator, no quotes, nothing that can quote well and fill
 * badly.
 *
 * Source the USDC by withdrawing from the OKX exchange to the owner address,
 * network X Layer. (Swapping into it on-chain is exactly the thing that
 * doesn't work right now.)
 *
 *   npm run fund:router               # dry run — balances only
 *   npm run fund:router -- --confirm  # transfer (default 5 USDC, or all if less)
 */

const CONFIRM = process.argv.includes("--confirm");
const TARGET = 5_000_000n; // 5 USDC

const ERC20 = [
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

  const ownerUsdc = (await publicClient.readContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "balanceOf",
    args: [owner.address],
  })) as bigint;
  const routerUsdc = (await publicClient.readContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "balanceOf",
    args: [config.demoRouter],
  })) as bigint;

  console.log(`owner  ${owner.address}  USDC ${formatUnits(ownerUsdc, 6)}`);
  console.log(`router ${config.demoRouter}  USDC ${formatUnits(routerUsdc, 6)}\n`);

  if (routerUsdc >= TARGET) {
    console.log("Router reserve already funded. Nothing to do.");
    process.exit(0);
  }
  if (ownerUsdc === 0n) {
    console.error(
      "Owner holds no USDC. Withdraw ~5 USDC from the OKX exchange to the owner\n" +
        "address above — network X LAYER — then re-run.",
    );
    process.exit(1);
  }

  const amount = ownerUsdc < TARGET ? ownerUsdc : TARGET;

  if (!CONFIRM) {
    console.log(`Would transfer ${formatUnits(amount, 6)} USDC → router. Re-run with --confirm.`);
    process.exit(0);
  }

  const wallet = createWalletClient({
    account: owner,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  const hash = await wallet.writeContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "transfer",
    args: [config.demoRouter, amount],
    chain: activeChain,
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Transferred ${formatUnits(amount, 6)} USDC to the router. tx ${hash}`);
  console.log("Next: allowlist the router if you haven't, then npm run execute:mainnet");
  process.exit(0);
}

main().catch((err) => {
  console.error("fund-router failed:", err);
  process.exit(1);
});
