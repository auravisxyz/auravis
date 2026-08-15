import { config } from "./config.js";
import { activeChain, agentAccount, publicClient } from "./chain.js";
import { createPriceFeed } from "./price.js";
import { startWatchLoop } from "./watcher.js";
import { mandateCount } from "./mandate.js";
import { listActiveTriggers, markTriggerTriggered, recordExecution } from "./db/store.js";

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
    listActiveTriggers,
    priceFeed,
    async (fire) => {
      console.log(
        `[fire] mandate ${fire.trigger.mandateId} — ${fire.trigger.token} crossed ` +
          `${fire.trigger.direction} ${fire.trigger.targetPrice} (now ${fire.currentPrice})`,
      );

      // Catch mode: notify the user, wait for their confirmation, then execute.
      // Auto mode: call executeMandate() directly here. Neither is wired yet —
      // this is the next milestone.
      //
      // We mark the trigger `triggered`, NOT `fired`: the price crossed, but
      // nothing has been bought. Marking it fired here would make an unexecuted
      // alert indistinguishable from a completed purchase in the dashboard.
      // Moving it out of `active` is still necessary so we don't re-alert on
      // every tick while price sits past the target.
      if (fire.trigger.id !== undefined) {
        await recordExecution({
          triggerId: fire.trigger.id,
          mandateId: fire.trigger.mandateId,
          status: "pending",
          reason: `Price ${fire.trigger.direction === "below" ? "dropped to" : "rose to"} ${fire.currentPrice}, crossing target ${fire.trigger.targetPrice}. Awaiting Catch/Auto execution wiring.`,
        });
        await markTriggerTriggered(fire.trigger.id);
      }
    },
    config.agent.pollIntervalMs,
  );

  process.on("SIGINT", () => {
    console.log("\nShutting down");
    stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
