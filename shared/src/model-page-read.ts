import type { PageCapture } from "./index.js";
import {
  HeuristicPageReader,
  PAGE_READ_SYSTEM_PROMPT,
  type PageKind,
  type PageReader,
  type PageReading,
} from "./page-read.js";
import type { ModelConfig } from "./model-intent.js";

/**
 * Model-backed page reading, behind the same PageReader interface.
 *
 * Server-side only, same reasoning as ModelIntentExtractor: a key shipped in
 * an extension is public within the hour.
 *
 * Every failure path lands in HeuristicPageReader rather than throwing. This
 * runs before the user has typed anything, so a failure here must never be
 * something they can see fail.
 */
export class ModelPageReader implements PageReader {
  private fallback = new HeuristicPageReader();

  constructor(private cfg: ModelConfig) {}

  async read(capture: PageCapture): Promise<PageReading> {
    try {
      const raw = await this.callModel(capture);
      return this.parse(raw, capture);
    } catch (err) {
      console.warn(
        "[page-read] model failed, using heuristic:",
        err instanceof Error ? err.message : err,
      );
      return this.fallback.read(capture);
    }
  }

  /**
   * More page text than intent extraction gets. Telling a shop from an article
   * needs the opening paragraphs; resolving "it" in an instruction does not.
   * Still capped, and still nowhere near the whole capture.
   */
  private buildUserPrompt(capture: PageCapture): string {
    return JSON.stringify({
      title: capture.title,
      url: capture.url,
      detectedPrice: capture.primaryPrice?.raw ?? null,
      priceSource: capture.primaryPrice?.source ?? null,
      excerpt: capture.excerpt.slice(0, 1200),
    });
  }

  private async callModel(capture: PageCapture): Promise<string> {
    const user = this.buildUserPrompt(capture);

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
          max_tokens: 400,
          system: PAGE_READ_SYSTEM_PROMPT,
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
          { role: "system", content: PAGE_READ_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("model returned no content");
    return text;
  }

  /**
   * Validate rather than trust, and enforce the rules the prompt states.
   * A model that says a token chart has delivery is corrected here, because
   * the UI would otherwise print a caveat that makes no sense on that page.
   */
  private parse(raw: string, capture: PageCapture): PageReading {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const kinds: PageKind[] = ["shop", "market", "listing", "reading", "other"];
    const kind = kinds.includes(parsed.kind as PageKind) ? (parsed.kind as PageKind) : "other";

    const bool = (v: unknown, fallback = false): boolean =>
      typeof v === "boolean" ? v : fallback;

    // Delivery cannot apply to a quoted market price or an article, whatever
    // the model said.
    const deliveryApplies =
      kind === "market" || kind === "reading" ? false : bool(parsed.deliveryApplies);

    const subject =
      typeof parsed.subject === "string" && parsed.subject.trim().length > 0
        ? parsed.subject.trim().slice(0, 120)
        : capture.title || "this page";

    const note =
      typeof parsed.note === "string" && parsed.note.trim().length > 0
        ? parsed.note.trim().slice(0, 200)
        : "";

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;

    return {
      kind,
      subject,
      priceIsActionable: bool(parsed.priceIsActionable, Boolean(capture.primaryPrice)),
      deliveryApplies,
      taxAtCheckout: bool(parsed.taxAtCheckout, capture.extraCosts?.taxAtCheckout ?? false),
      watchable: bool(parsed.watchable, Boolean(capture.primaryPrice)),
      note,
      confidence,
    };
  }
}
