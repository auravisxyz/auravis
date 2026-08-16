import { createWalletClient, http, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";

/**
 * Stocks the public demo vault so a reviewer can drive Auravis themselves.
 *
 * Every vault has exactly one owner, which is the right shape for a
 * non-custodial product and the wrong shape for someone evaluating it: connect
 * a wallet that isn't the owner and the dashboard correctly refuses to let you
 * touch anything. So we run a second vault on TESTNET whose key is published
 * in the README. Import it, and you get the full owner view with nothing of
 * value at stake.
 *
 *   npm run setup:demo               # show what it would do
 *   npm run setup:demo -- --confirm  # mint, deposit, allowlist, open a mandate
 *
 * Requires DEMO_PRIVATE_KEY and DEMO_VAULT_TESTNET, and refuses to run on
 * mainnet — the mock token mints freely and the router pays from a reserve,
 * neither of which should exist anywhere near real money.
 */

const CONFIRM = process.argv.includes("--confirm");

const MINT = 1_000_000_000n; // 1,000 mock USDT
const DEPOSIT = 200_000_000n; //   200 into the vault
const LIFETIME_CAP = 50_000_000n; //  50 spendable by the agent
const WINDOW_CAP = 20_000_000n; //  20 per window
const WINDOW_LENGTH = 3600n; // one hour
const FLOOR = 990_000_000_000_000_000n; // 0.99 out per 1.00 in

const TOKEN_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
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
] as const;

async function main() {
  if (config.network !== "testnet") {
    console.error(`NETWORK is "${config.network}". The demo vault is testnet only.`);
    process.exit(1);
  }

  const missing = [
    !config.demoPrivateKey && "DEMO_PRIVATE_KEY",
    !config.demoVault && "DEMO_VAULT_TESTNET",
    !config.mockUsdt && "MOCK_USDT_TESTNET",
    !config.mockUsdc && "MOCK_USDC_TESTNET",
    !config.mockRouter && "MOCK_ROUTER_TESTNET",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  const demo = privateKeyToAccount(config.demoPrivateKey as `0x${string}`);
  const vault = config.demoVault as Address;
  const usdt = config.mockUsdt as Address;
  const usdc = config.mockUsdc as Address;
  const router = config.mockRouter as Address;

  const wallet = createWalletClient({
    account: demo,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  console.log(CONFIRM ? "DEMO SETUP — LIVE\n" : "DEMO SETUP — DRY RUN\n");
  console.log(`demo wallet ${demo.address}`);
  console.log(`vault       ${vault}`);

  const owner = (await publicClient.readContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "owner",
  })) as Address;

  if (owner.toLowerCase() !== demo.address.toLowerCase()) {
    console.error(`\nVault owner is ${owner}, not the demo wallet. Deploy it with`);
    console.error(`VAULT_OWNER set to the demo address before running this.`);
    process.exit(1);
  }
  console.log(`owner check ok`);

  const gas = await publicClient.getBalance({ address: demo.address });
  console.log(`gas         ${formatUnits(gas, 18)} OKB`);
  if (gas === 0n) {
    console.error("\nThe demo wallet has no testnet OKB and cannot pay gas.");
    console.error("Send it a little, then re-run.");
    process.exit(1);
  }

  console.log(`\nwould mint    ${formatUnits(MINT, 6)} mock USDT to the demo wallet`);
  console.log(`would deposit ${formatUnits(DEPOSIT, 6)} into the vault`);
  console.log(`would allow   router ${router}`);
  console.log(
    `would open    a mandate: cap ${formatUnits(LIFETIME_CAP, 6)}, ` +
      `window ${formatUnits(WINDOW_CAP, 6)}/hr, floor 0.99`,
  );

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --confirm to send it.");
    process.exit(0);
  }

  console.log("\n[1/4] minting mock USDT…");
  let hash = await wallet.writeContract({
    address: usdt,
    abi: TOKEN_ABI,
    functionName: "mint",
    args: [demo.address, MINT],
    chain: activeChain,
    account: demo,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("[2/4] approving and depositing…");
  hash = await wallet.writeContract({
    address: usdt,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [vault, DEPOSIT],
    chain: activeChain,
    account: demo,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  hash = await wallet.writeContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "deposit",
    args: [usdt, DEPOSIT],
    chain: activeChain,
    account: demo,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("[3/4] allowlisting the rehearsal router…");
  hash = await wallet.writeContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "setRouterAllowed",
    args: [router, true],
    chain: activeChain,
    account: demo,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("[4/4] opening a mandate…");
  hash = await wallet.writeContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "openMandate",
    args: [
      usdt,
      usdc,
      LIFETIME_CAP,
      WINDOW_CAP,
      WINDOW_LENGTH,
      0n, // no expiry
      FLOOR,
      "buy USDC with USDT when the price is right",
    ],
    chain: activeChain,
    account: demo,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`\nDemo vault ready. Import the key, connect, and you own this one.`);
  console.log(`${activeChain.blockExplorers?.default.url}/address/${vault}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("setup-demo failed:", err);
  process.exit(1);
});
