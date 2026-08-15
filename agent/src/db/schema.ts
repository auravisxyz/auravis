import {
  pgTable,
  serial,
  integer,
  bigint,
  numeric,
  doublePrecision,
  text,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * A trigger is off-chain: "watch this token, and when its price crosses this
 * line, this mandate is allowed to act." See watcher.ts for why this stays
 * off-chain while spend caps stay on-chain.
 *
 * `intent` keeps the user's own plain-English instruction (e.g. "buy $200 if
 * it drops 8%") so the dashboard can show back exactly what was asked for,
 * not just the parsed numbers.
 */
export const triggers = pgTable("triggers", {
  id: serial("id").primaryKey(),
  mandateId: bigint("mandate_id", { mode: "bigint" }).notNull(),
  token: varchar("token", { length: 64 }).notNull(),
  direction: varchar("direction", { length: 8 }).notNull(), // "below" | "above"
  targetPrice: doublePrecision("target_price").notNull(),
  // uint256-safe: numeric(78,0) comfortably covers any ERC-20 base-unit amount.
  amountIn: numeric("amount_in", { precision: 78, scale: 0 }).notNull(),
  intent: text("intent").notNull(),
  mode: varchar("mode", { length: 8 }).notNull().default("catch"), // "catch" | "auto"
  /**
   * active    — being watched
   * triggered — price crossed; alert raised, purchase NOT yet made
   * fired     — purchase confirmed on-chain
   *
   * `triggered` and `fired` are deliberately distinct. Collapsing them would
   * mean a trigger that merely crossed its price looks identical to one that
   * actually bought — which is exactly the sort of thing that reads fine in
   * code and lies to the user in the UI.
   */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  firedAt: timestamp("fired_at", { withTimezone: true }),
});

/**
 * One row per attempted fire. This is what powers the dashboard's "what I
 * did and why" feed alongside the contract's own events — this table covers
 * the off-chain half (skipped, pending, notified) and the contract covers
 * the on-chain half (actually spent).
 */
export const executions = pgTable("executions", {
  id: serial("id").primaryKey(),
  triggerId: integer("trigger_id")
    .notNull()
    .references(() => triggers.id),
  mandateId: bigint("mandate_id", { mode: "bigint" }).notNull(),
  status: varchar("status", { length: 16 }).notNull(), // pending | confirmed | reverted | skipped
  reason: text("reason"),
  txHash: varchar("tx_hash", { length: 66 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
