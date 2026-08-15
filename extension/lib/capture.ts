import type { PageCapture } from "@auravis/shared";

/**
 * Pulls the minimum useful signal off a page.
 *
 * Deliberately not the whole DOM. We need enough for a model to reason about
 * what the user is looking at, and nothing more — a smaller excerpt is cheaper,
 * faster, and means we're not hoovering up someone's page content wholesale.
 */

/** Matches $1,299.00 / €45 / 1299 USD / £9.99 and similar. */
const PRICE_PATTERN =
  /(?:[$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|USDT|USDC|ETH|BTC|OKB)\b)/gi;

const MAX_EXCERPT = 2_000;
const MAX_PRICES = 12;

export function extractPriceCandidates(text: string): string[] {
  const found = text.match(PRICE_PATTERN) ?? [];
  const cleaned = found.map((s) => s.replace(/\s+/g, " ").trim());
  // Dedupe but keep source order — the first price on a product page is
  // usually the actual price, and later ones are related items or shipping.
  return [...new Set(cleaned)].slice(0, MAX_PRICES);
}

/**
 * Prefers the main content region when a page marks one up. On a product page
 * this is the difference between capturing the item and capturing the nav bar,
 * cookie banner, and footer.
 */
export function readableText(doc: Document): string {
  const preferred =
    doc.querySelector("main") ??
    doc.querySelector("[role='main']") ??
    doc.querySelector("article") ??
    doc.body;

  const raw = preferred?.innerText ?? "";
  return raw.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function metaContent(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLMetaElement>(sel);
    const value = el?.content?.trim();
    if (value) return value;
  }
  return undefined;
}

export function capturePage(doc: Document = document): PageCapture {
  const text = readableText(doc);

  // og:title is usually the clean product name; document.title often carries
  // site branding and SEO noise ("Sony XM5 | Best Price | Shop Now").
  const title =
    metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ??
    doc.title ??
    "";

  const imageUrl = metaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);

  return {
    url: doc.location?.href ?? "",
    title: title.trim(),
    excerpt: text.slice(0, MAX_EXCERPT),
    priceCandidates: extractPriceCandidates(text),
    ...(imageUrl ? { imageUrl } : {}),
    capturedAt: new Date().toISOString(),
  };
}
