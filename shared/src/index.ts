/**
 * Types shared by the extension, dashboard and agent.
 *
 * These deliberately mirror the on-chain `Mandate` struct and the Postgres
 * schema. When those change, change this first — three codebases disagreeing
 * about the shape of a mandate is the kind of bug that only shows up in a demo.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// Capture — what the extension grabs off a page
// ---------------------------------------------------------------------------

/**
 * A raw page capture, before any interpretation. Kept separate from the parsed
 * intent so we can always show the user what we actually saw, and so a bad
 * extraction can be re-run against the original without re-visiting the page.
 */
export interface PageCapture {
  url: string;
  title: string;
  /** Visible text, trimmed. Not the full DOM — we only need enough to reason. */
  excerpt: string;
  /** Any price-looking strings found, in source order. */
  priceCandidates: string[];
  /** Open Graph / product image, if the page offers one. */
  imageUrl?: string;
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Intent — the user's instruction, parsed
// ---------------------------------------------------------------------------

export type TriggerDirection = "below" | "above";
export type ExecutionMode = "catch" | "auto";

/**
 * The structured form of "buy $200 worth if it drops 8%".
 *
 * `confidence` and `assumptions` exist because extraction will sometimes be
 * wrong, and the honest response to that is to show the user what we inferred
 * rather than silently committing their money to a guess.
 */
export interface IntentDraft {
  /** Restated in plain English, for the confirmation screen. */
  summary: string;
  spendToken: Address | null;
  buyToken: Address | null;
  /** Human amount, e.g. 200 for "$200 worth". Base units come later. */
  amount: number | null;
  currency: string;
  direction: TriggerDirection;
  /** Absolute target price, once resolved. */
  targetPrice: number | null;
  /** Relative move, e.g. 8 for "if it drops 8%". */
  targetPercent: number | null;
  mode: ExecutionMode;
  /** 0–1. Below ~0.6 the UI should ask rather than assume. */
  confidence: number;
  /** Anything we filled in that the user didn't actually say. */
  assumptions: string[];
  /** The user's original words, preserved verbatim. */
  rawInstruction: string;
}

// ---------------------------------------------------------------------------
// Mandate — mirrors the on-chain struct
// ---------------------------------------------------------------------------

export interface Mandate {
  id: string;
  spendToken: Address;
  buyToken: Address;
  /** Base units, as strings — these exceed Number.MAX_SAFE_INTEGER. */
  lifetimeCap: string;
  spent: string;
  windowCap: string;
  windowSpent: string;
  windowLengthSeconds: number;
  windowStart: number;
  /** Unix seconds. 0 means no expiry. */
  expiry: number;
  active: boolean;
  intent: string;
  /** Minimum buyToken per 1e18 spendToken. Owner-set; the agent cannot change it. */
  minOutPerUnit: string;
}

/** Mirrors the contract's `canExecute` — allowed, plus why not. */
export interface MandateCheck {
  allowed: boolean;
  why: string;
}

// ---------------------------------------------------------------------------
// Trigger + execution — the off-chain half
// ---------------------------------------------------------------------------

export type TriggerStatus = "active" | "triggered" | "fired" | "cancelled" | "expired";

export interface Trigger {
  id: number;
  mandateId: string;
  token: string;
  direction: TriggerDirection;
  targetPrice: number;
  amountIn: string;
  intent: string;
  mode: ExecutionMode;
  status: TriggerStatus;
  createdAt: string;
  triggeredAt?: string;
  firedAt?: string;
}

export type ExecutionStatus = "pending" | "confirmed" | "reverted" | "skipped";

/**
 * One row of the "what I did and why" feed. `reason` carries the contract's
 * own refusal string where there is one — a refusal is a product feature here,
 * not an error to be swallowed.
 */
export interface ExecutionRecord {
  id: number;
  triggerId: number;
  mandateId: string;
  status: ExecutionStatus;
  reason?: string;
  txHash?: Hex;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Messaging between extension surfaces
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | { type: "CAPTURE_PAGE" }
  | { type: "CAPTURE_RESULT"; capture: PageCapture }
  | { type: "EXTRACT_INTENT"; capture: PageCapture; instruction: string }
  | { type: "INTENT_RESULT"; draft: IntentDraft }
  | { type: "ERROR"; message: string };

// ---------------------------------------------------------------------------
// Re-exports — one import path for consumers
// ---------------------------------------------------------------------------

/**
 * `intent.ts` imports types from here, but only as `import type`, which is
 * erased at compile time. So this is a type-level cycle, not a runtime one,
 * and consumers get everything from `@auravis/shared` without needing subpath
 * exports configured in three different bundlers.
 */
export { PatternIntentExtractor, INTENT_SYSTEM_PROMPT } from "./intent.js";
export type { IntentExtractor } from "./intent.js";
