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
  "amount": number | null,     // money to SPEND, e.g. 200 for "$200 worth"
  "quantity": number | null,   // number of UNITS, e.g. 1 for "buy 1"
  "currency": string,          // e.g. "USD"
  "direction": "below" | "above",
  "targetPrice": number | null,   // the price that TRIGGERS the buy
  "targetPercent": number | null, // relative move, e.g. 8 for "drops 8%"
  "mode": "catch" | "auto",
  "confidence": number,        // 0-1, how sure you are
  "assumptions": string[]      // anything you inferred that the user did not say
}

Three different numbers can appear in one sentence, and they are not interchangeable:
- amount is money leaving the wallet: "buy $83 worth", "spend 83$", "put 200 in"
- quantity is how many things: "buy 1", "get 2", "order 3 of them"
- targetPrice is the price that has to be reached before acting: "if it drops to $82", "at $85", "when it hits 40"

Worked examples:
- "buy 83$ if price drops 8%"        -> amount 83, quantity null, targetPrice null, targetPercent 8, direction "below"
- "buy 1 if price drops to 82$"      -> amount null, quantity 1, targetPrice 82, targetPercent null, direction "below"
- "buy at 85$ if price drops 8%"     -> amount null, quantity null, targetPrice 85, targetPercent 8, direction "below"
- "buy 2 when it goes under 40"      -> amount null, quantity 2, targetPrice 40, targetPercent null, direction "below"
- "tell me when it hits $40"         -> amount null, quantity null, targetPrice 40, direction depends on the page price

Money is written many ways and all of them count: $83, 83$, 83 usd, 83 dollars, 83 bucks.

Rules:
- Never invent an amount or a quantity. If the user did not state one, use null.
- A bare number straight after a buying word ("buy 1", "get 2") is a quantity, not money, unless a currency marker is attached.
- "drops 8%" means direction "below" and targetPercent 8.
- A price target and a percentage can both be present. Keep both.
- Default mode to "catch" unless the user explicitly asks for automatic execution.
- List every inference in "assumptions". Silent guesses about someone's money are worse than admitting uncertainty.
- If the instruction is ambiguous, lower confidence rather than picking arbitrarily.

Writing the "assumptions" and "summary":
These are read by someone about to commit their own money, on a small popup. Write the way you would say it out loud to them.

- Address them as "you". Say what you did and why, in one short sentence each.
- Never name a field or a value from this JSON. No "null", "targetPrice", "direction", "quantity", "the amount field", "set to". They cannot see this JSON and the words mean nothing to them.
- Never mention confidence, parsing, extraction, or models.
- No trailing full stops on fragments, and no more than about 15 words per line.

Say this:
  "You did not say how many or how much to spend"
  "$20 is below the $89.99 on the page, so I will wait for it to fall"
  "You will confirm before anything is bought"

Not this:
  "No quantity or spend amount was specified, so both are null"
  "Since $20 is below the current price, direction is assumed to be 'below'"
  "Mode defaulted to 'catch' since automatic execution was not explicitly requested"`;

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

    const percentMatch = text.match(/([\d.]+)\s*%/);
    const targetPercent = percentMatch?.[1] ? Number(percentMatch[1]) : null;

    /**
     * Every sum of money in the sentence, with where it appeared.
     *
     * The currency marker can lead or trail. Only accepting "$83" meant "83$"
     * parsed as nothing at all, and the popup told someone who had clearly
     * stated a budget that no amount was found.
     */
    const MONEY =
      /(?:\$\s*([\d,]+(?:\.\d+)?))|(?:\b([\d,]+(?:\.\d+)?)\s*(?:\$|usd|usdt|usdc|dollars?|bucks))/g;

    /** Words that mean the number after them is a threshold, not a budget. */
    const THRESHOLD_WORDS = "at|to|hits?|reaches|below|under|above|over|less than|more than|down to|up to";
    const THRESHOLD = new RegExp(`(?:${THRESHOLD_WORDS})\\s*$`);

    /** Words that mean the number after them is money being spent. */
    const SPEND = /(?:buy|spend|put|invest|worth|for|use)\s*$/;

    const money: Array<{ value: number; index: number; before: string }> = [];
    for (const m of text.matchAll(MONEY)) {
      const raw = m[1] ?? m[2] ?? "";
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      money.push({
        value,
        index: m.index ?? 0,
        // Enough lookbehind to catch "drops to " and "less than ".
        before: text.slice(Math.max(0, (m.index ?? 0) - 14), m.index ?? 0),
      });
    }

    const thresholds = money.filter((m) => THRESHOLD.test(m.before));
    const spends = money.filter((m) => !THRESHOLD.test(m.before) && SPEND.test(m.before));
    // Anything unlabelled: treat as spend when the sentence is about buying,
    // since "buy 83$ price drops 8%" has no preposition to key off.
    const loose = money.filter(
      (m) => !THRESHOLD.test(m.before) && !SPEND.test(m.before),
    );
    const buying = /\b(buy|get|grab|order|purchase|spend)\b/.test(text);

    /**
     * A threshold with no currency marker: "goes under 40", "above 99.5".
     * People drop the sign constantly once the page has already established
     * what currency we are in. The trailing guards matter: `(?!\s*%)` keeps
     * "drops 8%" from being read as a price of 8, and `(?![\d.])` stops a
     * partial match inside a longer number.
     */
    const BARE = new RegExp(
      `\\b(?:${THRESHOLD_WORDS})\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)(?!\\s*%)(?!\\d)`,
    );
    const bareMatch = text.match(BARE);
    const bareTarget = bareMatch?.[1] ? Number(bareMatch[1].replace(/,/g, "")) : null;

    const targetPrice = thresholds[0]?.value ?? bareTarget ?? null;
    const amount =
      spends[0]?.value ?? (buying ? (loose[0]?.value ?? null) : null) ?? null;

    /**
     * Quantity: a whole bare number straight after a buying word, with no
     * currency attached. "buy 1" is one of the thing, not one dollar, and
     * reading it as money is how you place a $1 order for a graphics card.
     *
     * `(?!\d)` is load-bearing. Without it "buy 83$" backtracks to the "8" in
     * "83", sees a "3" rather than a currency marker, and reports a quantity
     * of eight.
     */
    const quantityMatch = text.match(
      /\b(?:buy|get|grab|order|purchase)\s+(\d+(?:\.\d+)?)(?!\d)\s*(?!%|\$|usd|usdt|usdc|dollars?|bucks)/,
    );

    /** People write small counts as words at least as often as digits. */
    const WORD_NUMBERS: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const wordQuantityMatch = text.match(
      /\b(?:buy|get|grab|order|purchase)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b/,
    );

    const quantityValue =
      (quantityMatch?.[1] ? Number(quantityMatch[1]) : null) ??
      (wordQuantityMatch?.[1] ? (WORD_NUMBERS[wordQuantityMatch[1]] ?? null) : null);

    // A number already spoken for as money or as the trigger is not a count.
    const quantity =
      quantityValue !== null &&
      quantityValue !== targetPrice &&
      !money.some((m) => m.value === quantityValue)
        ? quantityValue
        : null;

    // "hits"/"reaches" are deliberately absent from both lists: "when it hits
    // $42" says nothing about which side you're approaching from. Treating it
    // as "above" made a buy-the-dip instruction wait for a rise instead.
    const fallsWord = /(drop|fall|dip|below|under|less than|cheaper)/.test(text);
    const risesWord = /(rise|rises|rising|above|over|more than|exceeds?)/.test(text);
    const direction: IntentDraft["direction"] = risesWord && !fallsWord ? "above" : "below";
    if (!fallsWord && !risesWord) {
      assumptions.push("You did not say up or down, so I will watch for it falling");
    }

    // "automatically" must match as readily as "auto" — the word boundary in
    // the previous pattern meant the most natural phrasing silently fell back
    // to Catch mode, which is the safe direction to fail but still wrong.
    const wantsAuto = /\bauto/.test(text) || /without asking|by itself|don'?t ask|on its own/.test(text);
    const mode: IntentDraft["mode"] = wantsAuto ? "auto" : "catch";
    if (mode === "catch" && !/\bask\b|\bconfirm\b|check with me/.test(text)) {
      assumptions.push("You will confirm before anything is bought");
    }
    if (mode === "auto") {
      assumptions.push("I will buy without asking, never past your cap");
    }

    // A quantity is a perfectly good way to say what you want. Only complain
    // when neither a budget nor a count was given.
    if (amount === null && quantity === null) {
      assumptions.push("You did not say how many or how much to spend");
    }
    if (targetPrice === null && targetPercent === null) {
      assumptions.push("You did not say what price to wait for");
    }

    // Confidence reflects how much we actually recovered, not how well the
    // regexes ran. Missing what to buy or when to act means we know little.
    let confidence = 0.9;
    if (amount === null && quantity === null) confidence -= 0.35;
    if (targetPrice === null && targetPercent === null) confidence -= 0.35;
    if (!fallsWord && !risesWord) confidence -= 0.1;
    confidence = Math.max(0.05, Number(confidence.toFixed(2)));

    const subject = capture.title || "this page";
    const condition =
      targetPrice !== null && targetPercent !== null
        ? `it ${direction === "below" ? "drops" : "rises"} ${targetPercent}% and reaches $${targetPrice}`
        : targetPrice !== null
          ? `it goes ${direction} $${targetPrice}`
          : targetPercent !== null
            ? `it ${direction === "below" ? "drops" : "rises"} ${targetPercent}%`
            : "a target we could not determine";

    const what =
      amount !== null
        ? `Buy $${amount} of ${subject}`
        : quantity !== null
          ? `Buy ${quantity} of ${subject}`
          : `Watch ${subject}`;

    return {
      summary:
        amount !== null || quantity !== null
          ? `${what} if ${condition}.`
          : `Watch ${subject} for when ${condition}, but nothing to buy was stated.`,
      spendToken: null,
      buyToken: null,
      amount,
      quantity,
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
