import type { PriceFeed } from "./price.js";
import { canExecute } from "./mandate.js";

/**
 * A trigger is off-chain state: "watch this token, and when its price crosses
 * this line, this mandate is allowed to act." The mandate contract only knows
 * about spend caps and routers — it has no concept of price. That split is
 * deliberate: triggers are cheap to evaluate and change; the cap is the one
 * thing that must be immovable, so it lives on-chain and nowhere else.
 *
 * Persisted in Postgres from day 2 (see CONTEXT.md). In-memory for now so the
 * watch loop itself can be built and proven today.
 */
export interface Trigger {
  /** DB row id, when persisted (src/db/store.ts). Absent for in-memory triggers. */
  id?: number;
  mandateId: bigint;
  token: string;
  direction: "below" | "above";
  targetPrice: number;
  /** Amount of spendToken to use when this fires, in base units. */
  amountIn: bigint;
  /**
   * catch — record the catch and wait for the user's confirmation.
   * auto  — execute immediately; the mandate's on-chain limits are the leash.
   */
  mode: "catch" | "auto";
}

export type TriggerFire = {
  trigger: Trigger;
  currentPrice: number;
};

/**
 * Checks every trigger against the current price and returns the ones that
 * should fire. Deliberately does not execute anything itself — evaluation
 * and action are kept separate so the same check can power both "notify the
 * user" (Catch mode) and "execute automatically" (Auto mode) without
 * duplicating the trigger logic.
 */
export async function evaluateTriggers(
  triggers: Trigger[],
  priceFeed: PriceFeed,
): Promise<TriggerFire[]> {
  const fires: TriggerFire[] = [];

  for (const trigger of triggers) {
    const price = await priceFeed.getPrice(trigger.token);
    const crossed =
      trigger.direction === "below" ? price <= trigger.targetPrice : price >= trigger.targetPrice;

    if (!crossed) continue;

    // Confirm the mandate would actually permit this before treating it as a
    // fire — a trigger crossing its price line means nothing if the mandate
    // has since been revoked, expired, or exhausted its cap.
    const { allowed, why } = await canExecute(trigger.mandateId, trigger.amountIn);
    if (!allowed) {
      console.log(
        `[watcher] trigger crossed for mandate ${trigger.mandateId} but mandate refuses: ${why}`,
      );
      continue;
    }

    fires.push({ trigger, currentPrice: price });
  }

  return fires;
}

/**
 * Polls forever at the configured interval. `onFire` decides what happens
 * next — for day 1 this just logs; Catch/Auto handling lands once the
 * mandate store and notification path exist.
 */
export function startWatchLoop(
  getTriggers: () => Trigger[] | Promise<Trigger[]>,
  priceFeed: PriceFeed,
  onFire: (fire: TriggerFire) => Promise<void>,
  intervalMs: number,
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const fires = await evaluateTriggers(await getTriggers(), priceFeed);
      for (const fire of fires) {
        await onFire(fire);
      }
    } catch (err) {
      console.error("[watcher] tick failed:", err);
    } finally {
      if (!stopped) setTimeout(tick, intervalMs);
    }
  };

  tick();

  return () => {
    stopped = true;
  };
}
