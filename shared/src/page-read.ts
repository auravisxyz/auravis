import type { PageCapture } from "./index.js";

/**
 * Reading a page, rather than guessing at it.
 *
 * The scraper answers "is there a price-shaped string here". That is not the
 * same question as "does a price mean anything on this page", and conflating
 * them is why the popup used to announce a number on a blog post and warn
 * about delivery on a price chart.
 *
 * The tell we used before was stock keywords: a page saying "in stock" was
 * treated as a shop. It misses every shop that doesn't use the phrase, and
 * fires on any article that happens to quote one. A model reading the title,
 * URL and opening text gets this right and can also say what the page is
 * about, which turns a silent heuristic into something the UI can show.
 */

export type PageKind =
  /** Sells a physical thing. Delivery and tax exist. */
  | "shop"
  /** Quotes a market price: a token, a stock, a commodity. No delivery. */
  | "market"
  /** A private or secondhand listing. May have delivery, rarely states tax. */
  | "listing"
  /** Article, docs, social, anything to read. A price here is quoted, not charged. */
  | "reading"
  | "other";

export interface PageReading {
  kind: PageKind;
  /** What this page is about, in the fewest words that identify it. */
  subject: string;
  /** Does the detected price mean "what you would pay for this"? */
  priceIsActionable: boolean;
  /** Could delivery apply at all. False on a token chart, true in a shop. */
  deliveryApplies: boolean;
  /** Page says tax is added later. */
  taxAtCheckout: boolean;
  /** Is there anything here worth watching a price on. */
  watchable: boolean;
  /** One line for the UI, in the product's voice. */
  note: string;
  /** 0 to 1. Low means the UI should offer rather than assert. */
  confidence: number;
}

export interface PageReader {
  read(capture: PageCapture): Promise<PageReading>;
}

export const PAGE_READ_SYSTEM_PROMPT = `You look at a web page and say what kind of page it is, so a price-watching agent knows whether a price on it means anything.

Answer with JSON only. No prose, no code fences.

{
  "kind": "shop" | "market" | "listing" | "reading" | "other",
  "subject": string,
  "priceIsActionable": boolean,
  "deliveryApplies": boolean,
  "taxAtCheckout": boolean,
  "watchable": boolean,
  "note": string,
  "confidence": number
}

kind:
- "shop"    a retailer selling a physical product. Amazon, a brand store, an electronics site.
- "market"  a quoted market price. A token page, a stock ticker, an exchange, a price chart.
- "listing" a private or secondhand sale. eBay auctions, classifieds, marketplace posts.
- "reading" an article, blog, doc, forum or social post. Prices mentioned here are discussed, not charged.
- "other"   anything else, including a page with no price relevance at all.

subject: what the page is about, short and specific. "Sony WH-1000XM5 headphones", "Ethereum", "an article about used car prices". Never a generic word like "product".

priceIsActionable: true only when the detected price is what someone would actually pay or trade at right now. An article quoting last year's price is false. A sold-out product still counts as true, because the price is real.

deliveryApplies: true only where a physical thing gets shipped. Always false for "market" and "reading".

taxAtCheckout: true only when the page itself indicates tax is added later.

watchable: true when watching this price over time would be useful. False for reading pages and for anything with no real price.

note: one plain sentence for the person, in their words not ours. Say what you see and what follows from it. Examples: "A product page, so delivery and tax will be added on top." / "A live market price, no delivery or tax involved." / "This is an article, so the prices in it are just being discussed." Never use jargon. Never mention JSON, models, or confidence.

confidence: how sure you are of kind, 0 to 1.`;

/**
 * The fallback when there is no model, or the model fails.
 *
 * This is the old stock-keyword heuristic, kept honest about being a guess:
 * it reports lower confidence and a vaguer note, so the UI can offer instead
 * of assert. Better a cautious reading than a hard failure in front of a user.
 */
export class HeuristicPageReader implements PageReader {
  async read(capture: PageCapture): Promise<PageReading> {
    const url = capture.url.toLowerCase();
    const hay = `${capture.title} ${capture.excerpt.slice(0, 600)}`.toLowerCase();
    const hasPrice = Boolean(capture.primaryPrice);

    const marketish =
      /coingecko|coinmarketcap|dexscreener|tradingview|binance|finance\.yahoo|okx\.com\/price/.test(url) ||
      /\b(market cap|24h volume|all.time high|trading pair)\b/.test(hay);

    const shoppish =
      capture.availability === "in-stock" ||
      capture.availability === "out-of-stock" ||
      /\b(add to cart|add to basket|buy now|free returns|ships? (?:to|from))\b/.test(hay);

    const kind: PageKind = marketish ? "market" : shoppish ? "shop" : hasPrice ? "listing" : "other";
    const deliveryApplies = kind === "shop" || kind === "listing";

    return {
      kind,
      subject: capture.title || "this page",
      priceIsActionable: hasPrice,
      deliveryApplies,
      taxAtCheckout: capture.extraCosts?.taxAtCheckout ?? false,
      watchable: hasPrice,
      note: hasPrice
        ? deliveryApplies
          ? "Looks like something for sale, so delivery and tax may be added on top."
          : "Found a price here."
        : "No price on this page. Name one in your instruction and I will still watch it.",
      confidence: marketish || shoppish ? 0.55 : 0.3,
    };
  }
}
