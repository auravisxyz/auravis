import { createTrigger, listActiveTriggers } from "./db/store.js";
import { mandateCount, canExecute } from "./mandate.js";
import { config } from "./config.js";

/**
 * Seeds one watch trigger so the loop has something to evaluate.
 * Run with: npm run seed
 *
 * Deliberately checks the on-chain side too. A trigger in Postgres that points
 * at a mandate which doesn't exist looks fine in the database and does nothing
 * useful — surfacing that here is more helpful than discovering it mid-demo.
 */
async function main() {
  if (!config.databaseUrl) {
    console.error("DATABASE_URL not set — nothing to seed.");
    process.exit(1);
  }

  const onChain = await mandateCount();
  console.log(`Mandates on vault: ${onChain}`);

  if (onChain === 0n) {
    console.warn(
      "\n⚠️  No mandates exist on-chain yet. The trigger below will be created,\n" +
        "   but when it fires the contract will refuse with \"mandate does not\n" +
        "   exist\" — which is itself a useful thing to watch happen.\n" +
        "   Open a real mandate first to see a full pass. See docs in README.\n",
    );
  }

  // `npm run seed -- --auto` seeds an auto-mode trigger; default is catch.
  const mode = process.argv.includes("--auto") ? ("auto" as const) : ("catch" as const);

  // Prefer the testnet rig's token when configured, so an auto fire has a
  // real router to execute against. Falls back to mainnet USDC otherwise.
  const token = config.mockUsdt ?? "0x74b7f16337b8972027f6196a17a631ac6de26d22";

  // Target is deliberately far above the mock price ($100 by default) so the
  // "below" condition is already true and it fires on the very next tick.
  const trigger = await createTrigger({
    mandateId: 0n,
    token,
    direction: "below",
    targetPrice: 200,
    amountIn: 10_000_000n, // 10 units at 6 decimals — inside the rig's 50/hr window
    intent: `${mode === "auto" ? "auto-" : ""}buy $10 worth if it drops below $200`,
    mode,
  });

  console.log("Seeded trigger:", {
    id: trigger.id,
    mandateId: trigger.mandateId.toString(),
    direction: trigger.direction,
    targetPrice: trigger.targetPrice,
    amountIn: trigger.amountIn.toString(),
  });

  const active = await listActiveTriggers();
  console.log(`Active triggers now: ${active.length}`);

  // Ask the contract directly what it would do. This is the same call the
  // watcher makes before treating a price cross as a real fire.
  const { allowed, why } = await canExecute(0n, 50_000_000n);
  console.log(`\nContract says: allowed=${allowed} — "${why}"`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
