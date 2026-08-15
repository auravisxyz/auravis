import { config } from "./config.js";
import { activeChain, agentAccount, publicClient } from "./chain.js";
import { createPriceFeed } from "./price.js";
import { startWatchLoop, type TriggerFire } from "./watcher.js";
import { mandateCount } from "./mandate.js";
import { executeAuto } from "./execution.js";
import {
  getActiveTriggersCached,
  markTriggerFired,
  markTriggerTriggered,
  recordExecution,
} from "./db/store.js";

async function main() {
  console.log("Auravis agent starting");
  console.log(`  network:        ${config.network} (chain ${activeChain.id})`);
  console.log(`  agent address:  ${agentAccount.address}`);
  console.log(`  mandate vault:  ${config.mandateAddress}`);

  const balance = await publicClient.getBalance({ address: agentAccount.address });
  console.log(`  agent OKB balance: ${balance} wei`);
  if (balance === 0n) {
    console.warn(
      "  ⚠️  agent wallet has zero OKB — it cannot pay gas to execute mandates yet",
    );
  }

  const count = await mandateCount();
  console.log(`  mandates on vault: ${count}`);

  const priceFeed = createPriceFeed();

  if (!config.databaseUrl) {
    console.warn(
      "  ⚠️  DATABASE_URL not set — watching zero triggers. Run `npm run db:migrate` " +
        "against a Postgres URL and configure DATABASE_URL to persist triggers.",
    );
  }

  console.log(`Polling every ${config.agent.pollIntervalMs}ms`);

  const stop = startWatchLoop(
    () => getActiveTriggersCached(),
    priceFeed,
    onFire,
    config.agent.pollIntervalMs,
  );

  process.on("SIGINT", () => {
    console.log("\nShutting down");
    stop();
    process.exit(0);
  });
}

/**
 * A trigger crossed its price line and the mandate pre-approved the spend.
 * What happens next is the product's central fork:
 *
 *   catch — record the catch and stop. The user confirms in the dashboard
 *           (through the OKX widget, which is what counts as interface volume).
 *           The agent's job was the vigil, not the purchase.
 *
 *   auto  — execute now. No prompt, no pause. The reason this is safe to offer
 *           at all is that the leash is on-chain: whatever this process does,
 *           the vault enforces cap, window, router and floor.
 *
 * Either way the trigger leaves `active` immediately — a crossed trigger that
 * stays active re-fires every tick — and only a *confirmed on-chain swap*
 * marks it `fired`. The distinction is what keeps the dashboard honest.
 */
async function onFire(fire: TriggerFire) {
  const { trigger, currentPrice } = fire;
  const moved = trigger.direction === "below" ? "dropped to" : "rose to";
  console.log(
    `[fire] mandate ${trigger.mandateId} — ${trigger.token} ${moved} ${currentPrice} ` +
      `(target ${trigger.targetPrice}, mode ${trigger.mode})`,
  );

  if (trigger.id === undefined) return;

  if (trigger.mode === "catch") {
    await recordExecution({
      triggerId: trigger.id,
      mandateId: trigger.mandateId,
      status: "pending",
      reason:
        `Caught it: price ${moved} ${currentPrice}, crossing your target of ` +
        `${trigger.targetPrice}. Waiting for your one-tap confirmation — nothing has ` +
        "been bought.",
    });
    await markTriggerTriggered(trigger.id);
    return;
  }

  // Auto mode. Move the trigger out of `active` BEFORE executing — if the
  // swap takes longer than a poll interval, a still-active trigger would
  // double-fire and double-spend inside the window cap.
  await markTriggerTriggered(trigger.id);

  const outcome = await executeAuto(trigger.mandateId, trigger.amountIn);

  if (outcome.ok) {
    await recordExecution({
      triggerId: trigger.id,
      mandateId: trigger.mandateId,
      status: "confirmed",
      reason: `Price ${moved} ${currentPrice}. ${outcome.reason}`,
      ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
    });
    await markTriggerFired(trigger.id);
    console.log(`[auto] executed: ${outcome.txHash}`);
  } else {
    await recordExecution({
      triggerId: trigger.id,
      mandateId: trigger.mandateId,
      status: "reverted",
      reason: `Price ${moved} ${currentPrice}, tried to execute. ${outcome.reason}`,
      ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
    });
    console.warn(`[auto] refused/failed: ${outcome.reason}`);
  }
}

main().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
