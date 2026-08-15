import type { IntentDraft, PageCapture } from "./index.js";

/**
 * Turns a page plus a plain-English instruction into a structured mandate draft.
 *
 * Kept as an interface for the same reason PriceFeed is: it lets the extension
 * and confirmation UI be built and demoed before a model provider is wired up,
 * and it means swapping providers later touches one file.
 */
export interface IntentExtractor {
  extract(capture: PageCapture, instruction: string): Promise<IntentDraft>;
}

/** The prompt is shared across providers so behaviour doesn't drift between them. */
export const INTENT_SYSTEM_PROMPT = `You convert a web page and a user's plain-English instruction into a structured trading mandate.

Return ONLY valid JSON matching this shape:
{
  "summary": string,           // restate the instruction plainly, for confirmation
  "amount": number | null,     // e.g. 200 for "$200 worth"
  "currency": string,          // e.g. "USD"
  "direction": "below" | "above",
  "targetPrice": number | null,   // absolute price, if stated
  "targetPercent": number | null, // relative move, e.g. 8 for "drops 8%"
  "mode": "catch" | "auto",
  "confidence": number,        // 0-1, how sure you are
  "assumptions": string[]      // anything you inferred that the user did not say
}

Rules:
- Never invent an amount. If the user did not state one, use null.
- "drops 8%" means direction "below" and targetPercent 8.
- Default mode to "catch" unless the user explicitly asks for automatic execution.
- List every inference in "assumptions". Silent guesses about someone's money are worse than admitting uncertainty.
- If the instruction is ambiguous, lower confidence rather than picking arbitrarily.`;

/**
 * Deterministic extractor with no model behind it.
 *
 * Handles the phrasings our demo actually uses, which is enough to build and
 * rehearse the whole capture → confirm flow offline. It is not a substitute
 * for the real thing: anything it cannot parse comes back with low confidence
 * and an explicit assumption saying so, rather than a confident wrong answer.
 */
export class PatternIntentExtractor implements IntentExtractor {
  async extract(capture: PageCapture, instruction: string): Promise<IntentDraft> {
    const text = instruction.toLowerCase();
    const assumptions: string[] = [];

    const amountMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)|\b([\d,]+(?:\.\d+)?)\s*(?:usd|dollars?)\b/);
    const amount = amountMatch
      ? Number((amountMatch[1] ?? amountMatch[2] ?? "").replace(/,/g, ""))
      : null;

    const percentMatch = text.match(/([\d.]+)\s*%/);
    const targetPercent = percentMatch?.[1] ? Number(percentMatch[1]) : null;

    // Absolute target. Must include the comparison words ("below 50", "above
    // 1000") and not just "at"/"hits" — people phrase thresholds both ways,
    // and missing them silently produced a mandate with no trigger at all.
    const atMatch = text.match(
      /(?:at|hits?|reaches|below|under|above|over|less than|more than)\s*\$?\s*([\d,]+(?:\.\d+)?)/,
    );
    const targetPrice = atMatch?.[1] ? Number(atMatch[1].replace(/,/g, "")) : null;

    // "hits"/"reaches" are deliberately absent from both lists: "when it hits
    // $42" says nothing about which side you're approaching from. Treating it
    // as "above" made a buy-the-dip instruction wait for a rise instead.
    const fallsWord = /(drop|fall|dip|below|under|less than|cheaper)/.test(text);
    const risesWord = /(rise|rises|rising|above|over|more than|exceeds?)/.test(text);
    const direction: IntentDraft["direction"] = risesWord && !fallsWord ? "above" : "below";
    if (!fallsWord && !risesWord) {
      assumptions.push('No direction stated — assumed "below" (buy the dip).');
    }

    // "automatically" must match as readily as "auto" — the word boundary in
    // the previous pattern meant the most natural phrasing silently fell back
    // to Catch mode, which is the safe direction to fail but still wrong.
    const wantsAuto = /\bauto/.test(text) || /without asking|by itself|don'?t ask|on its own/.test(text);
    const mode: IntentDraft["mode"] = wantsAuto ? "auto" : "catch";
    if (mode === "catch" && !/\bask\b|\bconfirm\b|check with me/.test(text)) {
      assumptions.push("Defaulted to Catch mode — you confirm before anything is bought.");
    }
    if (mode === "auto") {
      assumptions.push("Auto mode — the agent will buy without asking, within your cap.");
    }

    if (amount === null) assumptions.push("No spend amount found in the instruction.");
    if (targetPrice === null && targetPercent === null) {
      assumptions.push("No price target found — could not tell when to act.");
    }

    // Confidence reflects how much we actually recovered, not how well the
    // regexes ran. Missing the amount or the trigger means we know very little.
    let confidence = 0.9;
    if (amount === null) confidence -= 0.35;
    if (targetPrice === null && targetPercent === null) confidence -= 0.35;
    if (!fallsWord && !risesWord) confidence -= 0.1;
    confidence = Math.max(0.05, Number(confidence.toFixed(2)));

    const subject = capture.title || "this page";
    const condition =
      targetPrice !== null
        ? `it goes ${direction} $${targetPrice}`
        : targetPercent !== null
          ? `it ${direction === "below" ? "drops" : "rises"} ${targetPercent}%`
          : "a target we couldn't determine";

    return {
      summary:
        amount !== null
          ? `Buy $${amount} of ${subject} if ${condition}.`
          : `Watch ${subject} for when ${condition} — but no spend amount was given.`,
      spendToken: null,
      buyToken: null,
      amount,
      currency: "USD",
      direction,
      targetPrice,
      targetPercent,
      mode,
      confidence,
      assumptions,
      rawInstruction: instruction,
    };
  }
}
