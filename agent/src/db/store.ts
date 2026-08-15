import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { triggers, executions } from "./schema.js";
import type { Trigger } from "../watcher.js";

export interface NewTriggerInput {
  mandateId: bigint;
  token: string;
  direction: "below" | "above";
  targetPrice: number;
  amountIn: bigint;
  intent: string;
  mode?: "catch" | "auto";
}

type TriggerRow = typeof triggers.$inferSelect;

function rowToTrigger(row: TriggerRow): Trigger {
  return {
    id: row.id,
    mandateId: row.mandateId,
    token: row.token,
    direction: row.direction as "below" | "above",
    targetPrice: row.targetPrice,
    amountIn: BigInt(row.amountIn),
  };
}

/** Persists a new watch trigger. Throws if Postgres isn't configured. */
export async function createTrigger(input: NewTriggerInput): Promise<Trigger> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured — cannot persist triggers");

  const [row] = await db
    .insert(triggers)
    .values({
      mandateId: input.mandateId,
      token: input.token,
      direction: input.direction,
      targetPrice: input.targetPrice,
      amountIn: input.amountIn.toString(),
      intent: input.intent,
      mode: input.mode ?? "catch",
    })
    .returning();

  if (!row) throw new Error("Insert into triggers returned no row");
  return rowToTrigger(row);
}

/**
 * All triggers currently being watched. Returns an empty array (not an
 * error) when Postgres isn't configured, so the watch loop can run with
 * nothing to watch rather than crashing — same fallback style as price.ts.
 */
export async function listActiveTriggers(): Promise<Trigger[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.select().from(triggers).where(eq(triggers.status, "active"));
  return rows.map(rowToTrigger);
}

/**
 * Price crossed and we raised the alert — but nothing has been bought yet.
 * Moves the trigger out of `active` so the watch loop stops re-alerting on
 * every tick while price sits past the target.
 */
export async function markTriggerTriggered(triggerId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(triggers)
    .set({ status: "triggered", triggeredAt: new Date() })
    .where(eq(triggers.id, triggerId));
}

/** The purchase actually settled on-chain. Only call after a confirmed tx. */
export async function markTriggerFired(triggerId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(triggers)
    .set({ status: "fired", firedAt: new Date() })
    .where(eq(triggers.id, triggerId));
}

export async function cancelTrigger(triggerId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.update(triggers).set({ status: "cancelled" }).where(eq(triggers.id, triggerId));
}

export interface RecordExecutionInput {
  triggerId: number;
  mandateId: bigint;
  status: "pending" | "confirmed" | "reverted" | "skipped";
  reason?: string;
  txHash?: string;
}

/** Logs an attempted fire — the off-chain half of the explanation feed. */
export async function recordExecution(input: RecordExecutionInput): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.insert(executions).values({
    triggerId: input.triggerId,
    mandateId: input.mandateId,
    status: input.status,
    reason: input.reason,
    txHash: input.txHash,
  });
}
