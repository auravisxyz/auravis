import { formatUnits, decodeEventLog, type Address } from "viem";
import { config } from "./config.js";
import { publicClient, agentAccount, activeChain } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { canExecute, executeMandate, getMandate } from "./mandate.js";
import { getSwapQuote } from "./swap.js";

/**
 * The first live execute(). Dry-run by default:
 *
 *   npm run execute:mainnet              # quote + checks, sends nothing
 *   npm run execute:mainnet -- --confirm # actually swaps
 *
 * This is the only script that moves money. Every check the contract performs
 * is repeated here first, so a failure shows up as a readable message instead
 * of a reverted transaction.
 */

const CONFIRM = process.argv.includes("--confirm");
const MANDATE_ID = 0n;
const SPEND = 10_000_000n; // 10 USDT

async function main() {
  console.log(CONFIRM ? "LIVE EXECUTE\n" : "EXECUTE — DRY RUN (nothing will be sent)\n");

  if (config.network !== "mainnet") {
    console.error(`NETWORK is "${config.network}". The aggregator only serves mainnet.`);
    process.exit(1);
  }

  const mandate = await getMandate(MANDATE_ID);
  console.log(`mandate #${MANDATE_ID}: "${mandate.intent}"`);
  console.log(`  spend ${mandate.spendToken} → buy ${mandate.buyToken}`);
  console.log(
    `  cap ${formatUnits(mandate.lifetimeCap, 6)}, spent ${formatUnits(mandate.spent, 6)}, ` +
      `window ${formatUnits(mandate.windowSpent, 6)}/${formatUnits(mandate.windowCap, 6)}`,
  );
  console.log(`  price floor ${mandate.minOutPerUnit} (per 1e18 spend units)`);
  console.log(`  active: ${mandate.active}`);

  // 1. Ask the contract before spending gas finding out.
  const { allowed, why } = await canExecute(MANDATE_ID, SPEND);
  console.log(`\ncanExecute(${formatUnits(SPEND, 6)}): ${allowed} — "${why}"`);
  if (!allowed) {
    console.error("\nThe mandate refuses this. Fix the cause above before retrying.");
    process.exit(1);
  }

  // 2. Fresh quote. The vault is the caller on-chain, so it must be the
  //    userWalletAddress — quoting for the agent would build calldata that
  //    pays the agent, which our own price floor would then reject.
  const quote = await getSwapQuote({
    fromToken: mandate.spendToken as Address,
    toToken: mandate.buyToken as Address,
    amount: SPEND,
    vaultAddress: config.mandateAddress as Address,
    slippagePercent: "0.5",
  });

  console.log(`\nquote:`);
  console.log(`  router      ${quote.router}`);
  console.log(`  expect out  ${formatUnits(quote.toTokenAmount, 6)}`);
  console.log(`  min out     ${formatUnits(quote.minReceiveAmount, 6)}`);
  console.log(`  impact      ${quote.priceImpactPercent}%`);
  console.log(`  calldata    ${quote.data.slice(0, 42)}… (${(quote.data.length - 2) / 2} bytes)`);

  // 3. Confirm the router the quote wants is actually allowlisted. The contract
  //    would revert anyway, but a clear message beats decoding a revert.
  const allowlisted = await publicClient.readContract({
    address: config.mandateAddress as Address,
    abi: auravisMandateAbi,
    functionName: "allowedRouters",
    args: [quote.router],
  });
  console.log(`\nrouter allowlisted: ${allowlisted}`);
  if (!allowlisted) {
    console.error("Run `npm run setup:mainnet -- --confirm` to allowlist it first.");
    process.exit(1);
  }

  // 4. Two floors apply: the owner's minOutPerUnit (on-chain, binding) and the
  //    aggregator's slippage floor. We pass the aggregator's, and the contract
  //    takes whichever is stricter — so passing this can only tighten, never
  //    loosen, what the owner set.
  const ownerFloor = (SPEND * mandate.minOutPerUnit) / 10n ** 18n;
  console.log(`\nfloors: owner ${formatUnits(ownerFloor, 6)}, quote ${formatUnits(quote.minReceiveAmount, 6)}`);
  console.log(`  binding: ${quote.minReceiveAmount > ownerFloor ? "quote" : "owner"}`);

  const gas = await publicClient.getBalance({ address: agentAccount.address });
  console.log(`\nagent OKB: ${formatUnits(gas, 18)}`);
  if (gas === 0n) {
    console.error("Agent has no OKB and cannot pay gas.");
    process.exit(1);
  }

  if (!CONFIRM) {
    console.log("\nDry run finished. Nothing was sent. Re-run with --confirm to swap.");
    process.exit(0);
  }

  // 5. Go.
  console.log("\nSending execute()…");
  const hash = await executeMandate({
    id: MANDATE_ID,
    router: quote.router,
    swapData: quote.data,
    declaredIn: SPEND,
    minOut: quote.minReceiveAmount,
    reason: `Swapped ${formatUnits(SPEND, 6)} USDT for USDC at ${quote.priceImpactPercent}% impact.`,
  });
  console.log(`  tx ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  status: ${receipt.status}  block: ${receipt.blockNumber}`);
  console.log(`  ${activeChain.blockExplorers?.default.url}/tx/${hash}`);

  // Decode our own event rather than trusting the quote's estimate.
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: auravisMandateAbi, ...log });
      if (decoded.eventName === "MandateExecuted") {
        const a = decoded.args as unknown as {
          spent: bigint;
          received: bigint;
          lifetimeRemaining: bigint;
        };
        console.log(`\nMandateExecuted:`);
        console.log(`  spent     ${formatUnits(a.spent, 6)}`);
        console.log(`  received  ${formatUnits(a.received, 6)}`);
        console.log(`  remaining ${formatUnits(a.lifetimeRemaining, 6)} of the cap`);
      }
    } catch {
      // Logs from the router and tokens won't decode against our ABI. Expected.
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\nexecute failed:", err);
  process.exit(1);
});
