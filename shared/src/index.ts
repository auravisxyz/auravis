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
/**
 * The page's actual price, and where we got it.
 *
 * `source` matters: a price from structured data (JSON-LD, microdata) is the
 * page telling us what it costs, while a regex match is us guessing from text
 * that also contains shipping, variants and related items. The UI shows lower
 * confidence differently, because "we guessed" and "the page told us" should
 * not look identical to someone about to commit money.
 *
 * "corrected" outranks all of them. It means the person looked at our guess,
 * saw it was wrong, and told us the real number.
 */
export interface PagePrice {
  value: number;
  currency: string;
  raw: string;
  source: "json-ld" | "microdata" | "meta" | "guessed" | "corrected";
}

/**
 * Costs that sit on top of the listed price.
 *
 * The number a shop advertises is rarely the number you pay. On the Amazon
 * listing this was built against, shipping and import charges added $29.92 to
 * a $60.99 item — a price-drop alert ignoring that is misleading, not merely
 * incomplete.
 *
 * Tax is deliberately absent: it's computed at checkout against an address we
 * don't have and shouldn't ask for. We say it's excluded rather than pretend
 * to a precision we can't reach.
 */
export interface ExtraCosts {
  /** Detected shipping / delivery / import charge, if the page states one. */
  shipping?: { value: number; raw: string };
  /** True when the page mentions tax is added later. */
  taxAtCheckout: boolean;
}

/**
 * Whether the thing can currently be bought at all. A price alert on a
 * sold-out item sends someone to a page they can't act on — worse than
 * saying nothing.
 */
export type Availability = "in-stock" | "out-of-stock" | "unknown";

export interface PageCapture {
  url: string;
  title: string;
  /** Visible text, trimmed. Not the full DOM — we only need enough to reason. */
  excerpt: string;
  /** Our best single answer for what this page costs. */
  primaryPrice?: PagePrice;
  /** What the listed price doesn't include. */
  extraCosts?: ExtraCosts;
  availability?: Availability;
  /** Everything price-shaped we saw, in source order. Kept for the "not this one?" case. */
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
 * Which number a trigger actually tracks.
 *
 * These are not interchangeable, and picking one globally gets it wrong half
 * the time:
 *
 *  - "drops 8%" is a discount on the *item*. Shipping doesn't fall with it, so
 *    watching the delivered total means a genuine 8% sale may never fire.
 *  - "under $50" is a statement about what the user will *pay*. Watching the
 *    item price alerts them at $50 when the real cost is $80.
 *
 * So the basis follows the phrasing, and the UI says which one out loud.
 */
export type WatchBasis = "item" | "delivered";

export function basisForTarget(hasPercent: boolean, hasAbsolute: boolean): WatchBasis {
  if (hasPercent && !hasAbsolute) return "item";
  if (hasAbsolute) return "delivered";
  return "item";
}

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
  /**
   * How much money to spend, e.g. 200 for "$200 worth". Base units come later.
   *
   * Distinct from `quantity` and `targetPrice`, and conflating them is the
   * single easiest way to get someone's money wrong. Three different numbers
   * live in these sentences:
   *
   *   "buy $83 worth if it drops 8%"   amount 83
   *   "buy 1 if it drops to $82"       quantity 1, targetPrice 82
   *   "buy at $85"                     targetPrice 85, nothing to spend stated
   *
   * A parser that sees "83" and files it under whichever field it checks first
   * will happily spend $82 to watch for a price, or watch for $83 while
   * meaning to spend it.
   */
  amount: number | null;
  /** How many units, e.g. 1 for "buy 1". Not a sum of money. */
  quantity: number | null;
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
export { ModelIntentExtractor } from "./model-intent.js";
export type { ModelConfig } from "./model-intent.js";
export { HeuristicPageReader, PAGE_READ_SYSTEM_PROMPT } from "./page-read.js";
export type { PageKind, PageReader, PageReading } from "./page-read.js";
export { ModelPageReader } from "./model-page-read.js";
