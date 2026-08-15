import { browser } from "wxt/browser";
import type { Availability, PagePrice, TriggerDirection, WatchBasis } from "@auravis/shared";

/**
 * Watches stored locally in the extension.
 *
 * Deliberately NOT in Postgres like on-chain triggers. Re-checking an
 * arbitrary shop page has to happen in the user's own browser — their session,
 * their region, their account pricing. A server elsewhere gets bot-blocked,
 * sees another country's price, and misses signed-in discounts entirely. The
 * data lives where the checking happens.
 *
 * The privacy consequence is deliberate too: watch-only items never leave the
 * machine. Nothing is uploaded unless the user attaches money, at which point
 * it becomes an on-chain mandate with a different storage story.
 */
export interface Watch {
  id: string;
  url: string;
  title: string;
  /** Item price when the watch was created — the anchor for % targets. */
  basePrice: number;
  baseDelivered: number | null;
  currency: string;
  /** Which number the trigger tracks — see WatchBasis in @auravis/shared. */
  basis: WatchBasis;
  direction: TriggerDirection;
  targetPrice: number | null;
  targetPercent: number | null;
  intent: string;
  createdAt: string;
  /** Watches don't run forever — see DEFAULT_TTL_DAYS. */
  expiresAt: string;
  lastCheckedAt: string | null;
  lastSeenPrice: number | null;
  /** Stock state at last check. Lets "back in stock" be its own event. */
  lastStock: "in" | "out" | "unknown";
  status: "active" | "fired" | "unavailable" | "expired" | "cancelled";
  /** Consecutive failed checks — used to stop hammering a dead page. */
  failures: number;
}

/**
 * 90 days. Prices are seasonal and interest decays; a watch firing eleven
 * months later reads as spam from a tool you forgot. Expiry notifies once, so
 * renewal is one click rather than a surprise.
 */
export const DEFAULT_TTL_DAYS = 90;

const KEY = "auravis:watches";

export async function listWatches(): Promise<Watch[]> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as Watch[] | undefined) ?? [];
}

export async function saveWatches(watches: Watch[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: watches });
}

export async function addWatch(watch: Watch): Promise<void> {
  const all = await listWatches();
  // Same URL and same target is a duplicate, not a second watch. Replacing
  // rather than appending stops repeat clicks creating repeat notifications.
  const deduped = all.filter(
    (w) =>
      !(
        w.url === watch.url &&
        w.targetPrice === watch.targetPrice &&
        w.targetPercent === watch.targetPercent
      ),
  );
  deduped.push(watch);
  await saveWatches(deduped);
}

export async function updateWatch(id: string, patch: Partial<Watch>): Promise<void> {
  const all = await listWatches();
  await saveWatches(all.map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

/** The number this watch compares against, given its basis. */
export function currentValue(watch: Watch, price: number, delivered: number | null): number {
  if (watch.basis === "delivered" && delivered !== null) return delivered;
  return price;
}

/**
 * The number the target resolves to.
 *
 * Percentages always anchor to the item-price baseline captured at creation:
 * a discount is on the item, not on shipping — and anchoring to "the price
 * you saw that day" is also what makes the promise legible ("8% below the
 * $60.99 you saw" is checkable; "8% below whatever" is not).
 */
export function targetValue(watch: Watch): number | null {
  if (watch.targetPrice !== null) return watch.targetPrice;
  if (watch.targetPercent !== null) {
    const base = watch.basePrice;
    return watch.direction === "below"
      ? base * (1 - watch.targetPercent / 100)
      : base * (1 + watch.targetPercent / 100);
  }
  return null;
}

export function hasCrossed(watch: Watch, value: number): boolean {
  const target = targetValue(watch);
  if (target === null) return false;
  return watch.direction === "below" ? value <= target : value >= target;
}

export interface RecheckResult {
  price: PagePrice;
  shipping: number | null;
  availability: Availability;
}

/**
 * Cheap re-read: fetch the page's HTML from *this browser* and parse its
 * structured data. `credentials: "include"` is the whole point — the user's
 * own session, region and pricing.
 *
 * Does not execute the page's JavaScript, so client-rendered prices come back
 * null. The background falls back to a real (hidden) tab for those; this
 * exists because a fetch is ~free and covers most commerce sites, so the
 * heavy path stays rare.
 */
export async function recheckPrice(url: string): Promise<RecheckResult | null> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const toNumber = (s: string): number | undefined => {
    const n = Number(String(s).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const availability: Availability = /OutOfStock|SoldOut|Discontinued/i.test(html)
    ? "out-of-stock"
    : /InStock|LimitedAvailability/i.test(html)
      ? "in-stock"
      : /\b(out of stock|currently unavailable|sold out)\b/i.test(html)
        ? "out-of-stock"
        : "unknown";

  // JSON-LD first — same precedence as the live capture.
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    try {
      const parsed = JSON.parse(body ?? "");
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
        if (obj["offers"]) stack.push(obj["offers"]);
        const raw = obj["price"] ?? obj["lowPrice"];
        if (raw !== undefined) {
          const value = toNumber(String(raw));
          if (value !== undefined) {
            return {
              price: {
                value,
                currency: String(obj["priceCurrency"] ?? "USD"),
                raw: String(raw),
                source: "json-ld",
              },
              shipping: null,
              availability,
            };
          }
        }
      }
    } catch {
      // Malformed JSON-LD is common. Try the next block.
    }
  }

  const metaMatch = html.match(
    /<meta[^>]+(?:product:price:amount|og:price:amount)[^>]+content=["']([^"']+)["']/i,
  );
  const metaValue = metaMatch?.[1] ? toNumber(metaMatch[1]) : undefined;
  if (metaValue !== undefined) {
    return {
      price: { value: metaValue, currency: "USD", raw: metaMatch![1]!, source: "meta" },
      shipping: null,
      availability,
    };
  }

  return null;
}
