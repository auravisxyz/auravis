import type { IntentDraft, PageCapture } from "./index.js";
import { INTENT_SYSTEM_PROMPT, PatternIntentExtractor, type IntentExtractor } from "./intent.js";

/**
 * LLM-backed intent extraction behind the same IntentExtractor interface.
 *
 * Runs SERVER-SIDE ONLY (the web app's /api/intent route). An API key bundled
 * into a browser extension is public within the hour; the popup calls the
 * endpoint and falls back to the pattern extractor when it's unreachable.
 *
 * Every failure path — network, malformed JSON, out-of-range values — falls
 * back to PatternIntentExtractor rather than throwing. Extraction feeds a
 * confirmation screen, so the worst acceptable outcome is "less clever
 * parse", never "no parse".
 */

export interface ModelConfig {
  apiKey: string;
  provider: "anthropic" | "openai";
  /** Defaults: a small fast model per provider. This task is easy — latency matters more than depth. */
  model?: string;
  /** For OpenAI-compatible gateways (Groq, Together, local). Ignored for anthropic. */
  baseUrl?: string;
}

/**
 * Would a person recognise this as something said to them?
 *
 * The prompt asks for plain English, and mostly gets it. But "both are null"
 * reached a real confirmation screen, and this text sits directly above a
 * button that spends money. A dropped line costs a little context; a line
 * about null values costs the user's trust in the whole screen.
 */
const JARGON =
  /\b(null|undefined|targetprice|targetpercent|spendtoken|buytoken|json|field|parameter|parsed?|extraction|confidence|boolean|string value|set to)\b/i;

/**
 * The other tell: quoting one of our own enum values back at the user, as in
 * `direction is assumed to be 'below'`. Readable as English, but it is the
 * model narrating its output shape rather than telling someone what will
 * happen to their money.
 */
const QUOTED_ENUM = /['"](below|above|catch|auto)['"]/i;

function readableToAPerson(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !JARGON.test(trimmed) && !QUOTED_ENUM.test(trimmed);
}

export class ModelIntentExtractor implements IntentExtractor {
  private fallback = new PatternIntentExtractor();

  constructor(private cfg: ModelConfig) {}

  async extract(capture: PageCapture, instruction: string): Promise<IntentDraft> {
    try {
      const raw = await this.callModel(capture, instruction);
      return this.parse(raw, instruction);
    } catch (err) {
      console.warn(
        "[intent] model extraction failed, using pattern fallback:",
        err instanceof Error ? err.message : err,
      );
      return this.fallback.extract(capture, instruction);
    }
  }

  private buildUserPrompt(capture: PageCapture, instruction: string): string {
    // The model sees a trimmed view of the page — enough to resolve "it",
    // not the whole capture. Excerpts are user browsing data; send the minimum.
    return JSON.stringify({
      page: {
        title: capture.title,
        url: capture.url,
        price: capture.primaryPrice?.raw ?? null,
        currency: capture.primaryPrice?.currency ?? null,
        availability: capture.availability ?? "unknown",
      },
      instruction,
    });
  }

  private async callModel(capture: PageCapture, instruction: string): Promise<string> {
    const user = this.buildUserPrompt(capture, instruction);

    if (this.cfg.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.cfg.model ?? "claude-haiku-4-5-20251001",
          max_tokens: 500,
          system: INTENT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = body.content?.find((c) => c.type === "text")?.text;
      if (!text) throw new Error("anthropic returned no text");
      return text;
    }

    const base = this.cfg.baseUrl ?? "https://api.openai.com/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model ?? "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("model returned no content");
    return text;
  }

  /**
   * Validate hard rather than trust. A model that answers with a confident
   * malformed draft must land in the fallback, not in a confirmation screen.
   */
  private parse(raw: string, instruction: string): IntentDraft {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const direction = parsed.direction === "above" ? "above" : parsed.direction === "below" ? "below" : null;
    if (direction === null) throw new Error("model omitted direction");

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;

    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions
          .filter((a): a is string => typeof a === "string")
          .filter(readableToAPerson)
          .slice(0, 8)
      : [];

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.length > 0
          ? parsed.summary.slice(0, 500)
          : instruction,
      spendToken: null,
      buyToken: null,
      amount: num(parsed.amount),
      quantity: num(parsed.quantity),
      currency: typeof parsed.currency === "string" ? parsed.currency.slice(0, 8) : "USD",
      direction,
      targetPrice: num(parsed.targetPrice),
      targetPercent: num(parsed.targetPercent),
      mode: parsed.mode === "auto" ? "auto" : "catch",
      confidence,
      assumptions,
      rawInstruction: instruction,
    };
  }
}
