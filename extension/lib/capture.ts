import type { PageCapture, PagePrice } from "@auravis/shared";

/**
 * Pulls the minimum useful signal off a page.
 *
 * ⚠️ THIS FUNCTION MUST STAY SELF-CONTAINED.
 *
 * It is handed to `browser.scripting.executeScript({ func })`, which serialises
 * the function body and runs it in the page's own world. Module scope does not
 * travel with it — any reference to an outer constant or helper becomes a
 * ReferenceError at injection time, which surfaces to the user as a generic
 * "could not read this page" and gives no hint as to why.
 *
 * That is exactly what happened when the helpers lived at module scope. So
 * every regex, constant and helper below is declared *inside* the function,
 * even though that reads worse than hoisting them out.
 *
 * Deliberately not the whole DOM. We need enough for a model to reason about
 * what the user is looking at, and nothing more — smaller is cheaper, faster,
 * and avoids hoovering up someone's page wholesale.
 */
export function capturePage(): PageCapture {
  const PRICE_PATTERN =
    /(?:[$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|USDT|USDC|ETH|BTC|OKB)\b)/gi;
  const MAX_EXCERPT = 2_000;
  const MAX_PRICES = 12;

  function extractPrices(text: string): string[] {
    const found = text.match(PRICE_PATTERN) ?? [];
    const cleaned = found.map((s) => s.replace(/\s+/g, " ").trim());
    // Dedupe but keep source order — the first price on a product page is
    // usually the real one; later ones are related items or shipping.
    return [...new Set(cleaned)].slice(0, MAX_PRICES);
  }

  function readable(): string {
    // Prefer the main content region when the page marks one up. On a product
    // page that's the difference between capturing the item and capturing the
    // nav bar, cookie banner and footer.
    const preferred =
      document.querySelector("main") ??
      document.querySelector("[role='main']") ??
      document.querySelector("article") ??
      document.body;

    const raw = (preferred as HTMLElement | null)?.innerText ?? "";
    return raw
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function meta(selectors: string[]): string | undefined {
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLMetaElement | null;
      const value = el?.content?.trim();
      if (value) return value;
    }
    return undefined;
  }

  /**
   * Find the page's real price.
   *
   * Scraping visible text can't distinguish the item's price from shipping,
   * a variant, or a "customers also bought" tile — on the Amazon page that
   * tested this, the text scan returned the price, a rounded fragment of it,
   * the shipping charge and an unrelated variant, in that order.
   *
   * Most commerce pages already state the answer in structured data for
   * search engines. Ask them, in descending order of trustworthiness, and
   * only fall back to guessing when nothing declares it.
   */
  function findPrimaryPrice(bodyText: string): PagePrice | undefined {
    const toNumber = (s: string): number | undefined => {
      const n = Number(String(s).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    // 1. JSON-LD — schema.org Product/Offer. The most explicit signal there is.
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block.textContent ?? "");
        // Shape varies wildly: single object, array, or @graph. Walk it all.
        const stack: unknown[] = [parsed];
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== "object") continue;
          if (Array.isArray(node)) {
            stack.push(...node);
            continue;
          }
          const obj = node as Record<string, unknown>;
          if (obj["@graph"]) stack.push(obj["@graph"]);
          const offers = obj["offers"];
          if (offers) stack.push(offers);

          const price = obj["price"] ?? obj["lowPrice"];
          if (price !== undefined) {
            const value = toNumber(String(price));
            if (value !== undefined) {
              return {
                value,
                currency: String(obj["priceCurrency"] ?? "USD"),
                raw: String(price),
                source: "json-ld",
              };
            }
          }
        }
      } catch {
        // Malformed JSON-LD is extremely common. Skip and try the next signal.
      }
    }

    // 2. Microdata — itemprop="price".
    const micro = document.querySelector('[itemprop="price"]');
    if (micro) {
      const rawValue =
        (micro as HTMLMetaElement).content || micro.getAttribute("content") || micro.textContent;
      const value = toNumber(rawValue ?? "");
      if (value !== undefined) {
        const cur =
          document.querySelector('[itemprop="priceCurrency"]') as HTMLMetaElement | null;
        return {
          value,
          currency: cur?.content || "USD",
          raw: String(rawValue).trim(),
          source: "microdata",
        };
      }
    }

    // 3. Open Graph / product meta tags.
    const metaPrice = meta([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[name="twitter:data1"]',
    ]);
    if (metaPrice) {
      const value = toNumber(metaPrice);
      if (value !== undefined) {
        return {
          value,
          currency: meta(['meta[property="product:price:currency"]', 'meta[property="og:price:currency"]']) ?? "USD",
          raw: metaPrice,
          source: "meta",
        };
      }
    }

    // 4. Last resort: the first price-shaped string in the main content.
    //    Flagged as "guessed" so the UI can say so rather than imply certainty.
    const first = extractPrices(bodyText)[0];
    if (first) {
      const value = toNumber(first);
      if (value !== undefined) {
        const symbol = first.match(/[$£€¥]/)?.[0];
        const currency =
          symbol === "£" ? "GBP" : symbol === "€" ? "EUR" : symbol === "¥" ? "JPY" : "USD";
        return { value, currency, raw: first, source: "guessed" };
      }
    }

    return undefined;
  }

  /**
   * Find costs the listed price leaves out.
   *
   * Shops state shipping in prose ("$29.92 Shipping & Import Charges to
   * Nigeria"), so this reads the text near the relevant words rather than
   * hunting for a structured field that usually isn't there.
   *
   * Tax is only ever reported as a flag. It depends on a delivery address and
   * is calculated at checkout — claiming a total we can't compute would be
   * worse than admitting the number is incomplete.
   */
  function findExtraCosts(bodyText: string): {
    shipping?: { value: number; raw: string };
    taxAtCheckout: boolean;
  } {
    const shippingMatch = bodyText.match(
      /(?:shipping|delivery|import charges?)[^\n]{0,60}?([$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?)|([$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?)[^\n]{0,30}?(?:shipping|delivery|import charges?)/i,
    );
    const rawShipping = shippingMatch?.[1] ?? shippingMatch?.[2];

    // "free shipping" is common and means the opposite of a missing value.
    const freeShipping = /\bfree (?:shipping|delivery)\b/i.test(bodyText);

    const taxAtCheckout =
      /\b(?:tax(?:es)? (?:may )?(?:apply|added|calculated)|excl(?:uding|\.)? (?:tax|vat)|plus tax|vat added)\b/i.test(
        bodyText,
      );

    let shipping: { value: number; raw: string } | undefined;
    if (rawShipping && !freeShipping) {
      const value = Number(rawShipping.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(value) && value > 0) {
        shipping = { value, raw: rawShipping.trim() };
      }
    }

    return { ...(shipping ? { shipping } : {}), taxAtCheckout };
  }

  const text = readable();

  // og:title is usually the clean product name; document.title often carries
  // site branding and SEO noise ("Sony XM5 | Best Price | Shop Now").
  const title =
    meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ?? document.title ?? "";

  const imageUrl = meta(['meta[property="og:image"]', 'meta[name="twitter:image"]']);

  /**
   * Stock detection. JSON-LD availability is authoritative when present;
   * otherwise a text heuristic over the main content. "unknown" is an honest
   * answer — most non-shop pages have no stock concept at all.
   */
  function findAvailability(bodyText: string): "in-stock" | "out-of-stock" | "unknown" {
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const block of blocks) {
      const raw = block.textContent ?? "";
      // Substring check, deliberately: schema.org availability appears as a URL
      // ("https://schema.org/OutOfStock") and parsing the whole blob again for
      // one flag isn't worth it.
      if (/OutOfStock|SoldOut|Discontinued/i.test(raw)) return "out-of-stock";
      if (/InStock|LimitedAvailability|PreOrder/i.test(raw)) return "in-stock";
    }
    const head = bodyText.slice(0, 3000);
    if (/\b(out of stock|currently unavailable|sold out)\b/i.test(head)) return "out-of-stock";
    if (/\b(in stock|add to cart|buy now)\b/i.test(head)) return "in-stock";
    return "unknown";
  }

  const primaryPrice = findPrimaryPrice(text);
  const extraCosts = findExtraCosts(text);
  const availability = findAvailability(text);

  return {
    url: location.href,
    title: title.trim(),
    excerpt: text.slice(0, MAX_EXCERPT),
    ...(primaryPrice ? { primaryPrice } : {}),
    extraCosts,
    availability,
    priceCandidates: extractPrices(text),
    ...(imageUrl ? { imageUrl } : {}),
    capturedAt: new Date().toISOString(),
  };
}
