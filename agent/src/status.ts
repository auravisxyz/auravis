import { getDb } from "./db/client.js";
import { triggers, executions } from "./db/schema.js";
import { mandateCount, getMandate, canExecute } from "./mandate.js";
import { config } from "./config.js";

/**
 * Prints the current state of both halves of the system — the off-chain
 * triggers in Postgres and the on-chain mandates in the vault — side by side.
 * Run with: npm run status
 *
 * This is the same data the dashboard's "what I did and why" feed will render,
 * so getting it legible here first makes that page mostly a styling exercise.
 */
async function main() {
  console.log("=== ON-CHAIN ===");
  const count = await mandateCount();
  console.log(`Mandates on vault ${config.mandateAddress}: ${count}\n`);

  for (let i = 0n; i < count; i++) {
    const m = await getMandate(i);
    const spent = m.spent;
    const remaining = m.lifetimeCap - spent;
    const { allowed, why } = await canExecute(i, 1n);

    console.log(`Mandate #${i}`);
    console.log(`  intent:        "${m.intent}"`);
    console.log(`  spend token:   ${m.spendToken}`);
    console.log(`  lifetime cap:  ${m.lifetimeCap}  (spent ${spent}, ${remaining} left)`);
    console.log(`  window cap:    ${m.windowCap}  (${m.windowSpent} used this window)`);
    console.log(`  price floor:   ${m.minOutPerUnit}`);
    console.log(`  active:        ${m.active}`);
    console.log(`  contract says: ${allowed} — "${why}"\n`);
  }

  const db = getDb();
  if (!db) {
    console.log("=== OFF-CHAIN ===\nDATABASE_URL not set.");
    process.exit(0);
  }

  console.log("=== OFF-CHAIN (Postgres) ===");
  const allTriggers = await db.select().from(triggers);
  console.log(`Triggers: ${allTriggers.length}`);
  for (const t of allTriggers) {
    console.log(
      `  #${t.id} mandate=${t.mandateId} ${t.direction} ${t.targetPrice} ` +
        `amount=${t.amountIn} [${t.status}] mode=${t.mode}`,
    );
  }

  const allExecutions = await db.select().from(executions);
  console.log(`\nExecutions: ${allExecutions.length}`);
  for (const e of allExecutions) {
    console.log(`  #${e.id} trigger=${e.triggerId} [${e.status}] ${e.txHash ?? "no tx"}`);
    if (e.reason) console.log(`      ${e.reason}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("status failed:", err);
  process.exit(1);
});
