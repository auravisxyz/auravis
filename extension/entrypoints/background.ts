import { browser } from "wxt/browser";
import type { PageCapture } from "@auravis/shared";
import { capturePage } from "../lib/capture.js";
import {
  listWatches,
  updateWatch,
  recheckPrice,
  currentValue,
  hasCrossed,
  targetValue,
  type RecheckResult,
  type Watch,
} from "../lib/watchlist.js";

const ALARM = "auravis:check";
const PERIOD_MINUTES = 30;
/** Give up on a page after this many consecutive failures. */
const MAX_FAILURES = 5;
/**
 * Cap per cycle, most-stale first. 200 watches must not mean 200 fetches in a
 * burst — stalest-first means everything still gets visited, just spread
 * across cycles instead of hammered at once.
 */
const MAX_PER_RUN = 25;
/** Breathing room between checks — we are a guest on these sites. */
const DELAY_BETWEEN_MS = 500;

export default defineBackground(() => {
  // Page capture runs on demand from the popup, so nothing here reads pages
  // the user hasn't pointed at. The alarm only revisits URLs they explicitly
  // asked to watch, on origins they individually granted.
  browser.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void checkAll();
  });

  // Also shortly after startup — a browser closed overnight shouldn't wait
  // half an hour to notice an overnight drop.
  void checkAll();

  browser.notifications?.onClicked.addListener((id) => {
    const url = notificationTargets.get(id);
    if (url) void browser.tabs.create({ url });
    notificationTargets.delete(id);
  });
});

async function checkAll() {
  const watches = await listWatches();
  const now = Date.now();

  // Expiry sweep first, and tell the user once — a watch that silently stops
  // is indistinguishable from one that's still running, which breaks trust in
  // every other watch.
  for (const w of watches) {
    if (w.status === "active" && now > Date.parse(w.expiresAt)) {
      await updateWatch(w.id, { status: "expired" });
      await notify(
        "Watch expired",
        `Stopped watching "${w.title.slice(0, 50)}" after 90 days. Open the page and ` +
          "capture it again if you still want it.",
        w.url,
      );
    }
  }

  const active = (await listWatches())
    .filter((w) => w.status === "active")
    .sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""))
    .slice(0, MAX_PER_RUN);

  for (const watch of active) {
    try {
      await checkOne(watch);
    } catch (err) {
      console.warn("[auravis] check failed", watch.url, err);
      await recordFailure(watch);
    }
    await sleep(DELAY_BETWEEN_MS);
  }
}

async function checkOne(watch: Watch) {
  // Cheap path: plain fetch + structured-data parse.
  let result = await recheckPrice(watch.url);

  // Heavy path: sites that render prices with JavaScript yield nothing to a
  // fetch. Open a real (unfocused) tab, run the same capture the popup uses,
  // close it. Costs a tab flicker every half hour; buys correctness on the
  // large class of sites where fetch sees an empty shell.
  if (!result) result = await recheckViaTab(watch.url);

  if (!result) {
    await recordFailure(watch);
    return;
  }

  // A page that switched currency isn't comparable to its baseline. £60
  // against a $60 anchor would read as "no change" while the cost moved.
  if (result.price.currency !== watch.currency) {
    await updateWatch(watch.id, {
      status: "unavailable",
      lastCheckedAt: new Date().toISOString(),
    });
    await notify(
      "Auravis stopped watching",
      `"${watch.title.slice(0, 50)}" now shows prices in ${result.price.currency}, not ` +
        `${watch.currency}. Capture it again to watch in the new currency.`,
      watch.url,
    );
    return;
  }

  const delivered = result.shipping === null ? null : result.price.value + result.shipping;
  const value = currentValue(watch, result.price.value, delivered);
  const nowIso = new Date().toISOString();

  // --- Stock transitions ---------------------------------------------------
  if (result.availability === "out-of-stock") {
    // A price alert on something unbuyable sends the user to a dead end. Hold
    // fire, remember the state, and keep watching for restock.
    await updateWatch(watch.id, {
      lastCheckedAt: nowIso,
      lastSeenPrice: value,
      lastStock: "out",
      failures: 0,
    });
    return;
  }

  const cameBackInStock = watch.lastStock === "out" && result.availability === "in-stock";

  await updateWatch(watch.id, {
    lastCheckedAt: nowIso,
    lastSeenPrice: value,
    lastStock: result.availability === "in-stock" ? "in" : watch.lastStock,
    failures: 0,
  });

  if (cameBackInStock && !hasCrossed(watch, value)) {
    // Restock is its own event even when the price target hasn't hit — for a
    // sold-out item it's usually the thing the user actually cares about.
    await notify(
      "Back in stock",
      `"${watch.title.slice(0, 50)}" is available again at ${formatMoney(value, watch.currency)}.`,
      watch.url,
    );
    return;
  }

  if (!hasCrossed(watch, value)) return;

  const target = targetValue(watch);
  const movement = watch.direction === "below" ? "dropped to" : "risen to";
  const priceWord = watch.basis === "delivered" ? "Delivered price" : "Price";

  await updateWatch(watch.id, { status: "fired" });
  await notify(
    watch.title.slice(0, 60),
    `${priceWord} has ${movement} ${formatMoney(value, watch.currency)}` +
      (target !== null ? ` — you asked for ${formatMoney(target, watch.currency)}.` : "."),
    watch.url,
  );
}

/**
 * Re-run the popup's own capture inside a hidden tab. Same function, same
 * precedence rules — the only difference is the page's JavaScript has run.
 */
async function recheckViaTab(url: string): Promise<RecheckResult | null> {
  let tabId: number | undefined;
  try {
    const tab = await browser.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId === undefined) return null;

    await waitForLoad(tabId, 15_000);
    // One settle beat after "complete" — hydration frameworks paint prices a
    // moment after the load event.
    await sleep(1_000);

    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: capturePage,
    });

    const cap = results[0]?.result as PageCapture | undefined;
    if (!cap?.primaryPrice) return null;

    return {
      price: cap.primaryPrice,
      shipping: cap.extraCosts?.shipping?.value ?? null,
      availability: cap.availability ?? "unknown",
    };
  } catch {
    // Permission revoked, tab killed, page blocked scripting — all mean the
    // same thing to the caller: no reading this time.
    return null;
  } finally {
    if (tabId !== undefined) {
      await browser.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error("page load timed out"));
    }, timeoutMs);

    function listener(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

async function recordFailure(watch: Watch) {
  const failures = watch.failures + 1;
  if (failures >= MAX_FAILURES) {
    await updateWatch(watch.id, { status: "unavailable", failures });
    await notify(
      "Auravis lost track of a page",
      `"${watch.title.slice(0, 50)}" couldn't be read ${MAX_FAILURES} times in a row. It ` +
        "may be gone, moved, or need you signed in.",
      watch.url,
    );
    return;
  }
  await updateWatch(watch.id, { failures, lastCheckedAt: new Date().toISOString() });
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

const notificationTargets = new Map<string, string>();

async function notify(title: string, message: string, url?: string) {
  try {
    // Cast: WXT generates the PublicPath union at build time, and the icons
    // were added after the last build. Correct at runtime; the union catches
    // up on the next `wxt prepare`/build.
    const id = await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png" as never),
      title,
      message,
    });
    if (url) notificationTargets.set(id, url);
  } catch (err) {
    // A notification must never take the check loop down with it.
    console.warn("[auravis] notification failed", err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
