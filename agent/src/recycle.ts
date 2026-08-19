import { createWalletClient, http, formatUnits, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { TOKENS } from "./constants.js";

/**
 * Refills the router's payout reserve from the vault, without new money.
 *
 * The demo is a closed loop. Each swap moves USDT from the vault to the router
 * and USDC from the router to the vault, so after a few runs the router holds
 * the USDT and the vault holds all the USDC, and execution stops with a full
 * vault and a healthy cap. Nothing has been spent; it is just all sitting on
 * the wrong side.
 *
 * This walks it back: withdraw USDC from the vault to the owner, then send it
 * to the router. Two transactions, a fraction of a cent in gas, and the demo
 * is repeatable again.
 *
 *   npm run recycle                       # show both sides, send nothing
 *   npm run recycle -- --confirm          # move all of the vault's USDC
 *   npm run recycle -- --amount 4 --confirm
 */

const CONFIRM = process.argv.includes("--confirm");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

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

async function usdcOf(who: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "balanceOf",
    args: [who],
  })) as bigint;
}

async function main() {
  if (!config.ownerPrivateKey) {
    console.error("OWNER_PRIVATE_KEY not set. Only the owner can withdraw.");
    process.exit(1);
  }
  if (!config.mandateAddress || !config.demoRouter) {
    console.error("Need MANDATE_ADDRESS and DEMO_ROUTER_MAINNET set.");
    process.exit(1);
  }

  const owner = privateKeyToAccount(config.ownerPrivateKey);
  const vault = config.mandateAddress as Address;
  const router = config.demoRouter;

  const inVault = await usdcOf(vault);
  const inRouter = await usdcOf(router);
  const withOwner = await usdcOf(owner.address);

  console.log(CONFIRM ? "RECYCLE — LIVE\n" : "RECYCLE — DRY RUN\n");
  console.log(`vault  ${vault}  ${formatUnits(inVault, 6)} USDC`);
  console.log(`owner  ${owner.address}  ${formatUnits(withOwner, 6)} USDC`);
  console.log(`router ${router}  ${formatUnits(inRouter, 6)} USDC`);

  const requested = arg("amount");
  const wanted = requested ? parseUnits(requested, 6) : inVault;
  const amount = wanted > inVault ? inVault : wanted;

  if (amount === 0n) {
    console.log("\nThe vault holds no USDC. Nothing to move.");
    process.exit(0);
  }

  console.log(`\nwould move ${formatUnits(amount, 6)} USDC from the vault to the router`);
  console.log(`router reserve would become ${formatUnits(inRouter + amount, 6)}`);

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --confirm to move it.");
    process.exit(0);
  }

  const wallet = createWalletClient({
    account: owner,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  console.log("\n[1/2] withdrawing from the vault…");
  let hash = await wallet.writeContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "withdraw",
    args: [TOKENS.USDC, amount],
    chain: activeChain,
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("[2/2] sending to the router…");
  hash = await wallet.writeContract({
    address: TOKENS.USDC,
    abi: ERC20,
    functionName: "transfer",
    args: [router, amount],
    chain: activeChain,
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`\nRouter reserve is now ${formatUnits(await usdcOf(router), 6)} USDC.`);
  console.log("Ready to execute again.");
  process.exit(0);
}

main().catch((err) => {
  console.error("recycle failed:", err);
  process.exit(1);
});
