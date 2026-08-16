import { useEffect, useState } from "react";
import type { IntentDraft, PageCapture, PageReading, WatchBasis } from "@auravis/shared";
import { HeuristicPageReader, PatternIntentExtractor, basisForTarget } from "@auravis/shared";
import { capturePage } from "../../lib/capture.js";
import {
  addWatch,
  listWatches,
  updateWatch,
  targetValue,
  DEFAULT_TTL_DAYS,
  type Watch,
} from "../../lib/watchlist.js";

/** Below this, we ask rather than assume. It's the user's money. */
const CONFIDENCE_FLOOR = 0.6;

/** Where the dashboard lives. Overridden at build time for production. */
const APP_URL = import.meta.env.VITE_APP_URL ?? "http://localhost:3001";

/**
 * Which chain the vault this build talks to lives on.
 *
 * This was a hardcoded "Testnet" string, which kept claiming testnet long
 * after the contracts moved to mainnet. A label nobody updates is worse than
 * no label: it is the one piece of the UI a reviewer will take at face value.
 */
const NETWORK = import.meta.env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
const NETWORK_LABEL = NETWORK === "mainnet" ? "X Layer" : "Testnet";

/**
 * Pages whose asset can actually be bought on-chain. Everything else can be
 * watched — from the user's own browser, with their session and region — but
 * not purchased, because we have no payment rails into ordinary shops.
 * Honest gate, deliberately small. Grows as integrations do.
 */
const TRADEABLE_HOSTS = [
  /(^|\.)coingecko\.com$/i,
  /(^|\.)coinmarketcap\.com$/i,
  /(^|\.)okx\.com$/i,
  /(^|\.)dexscreener\.com$/i,
];

function isTradeablePage(url: string): boolean {
  try {
    return TRADEABLE_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", JPY: "¥" };

/**
 * A hero number earns its size by being readable. Two decimals above a dollar;
 * below a dollar, four significant figures — "$0.00" for a $0.00004521 token
 * would be confidently wrong, which is worse than long.
 */
function formatMoney(value: number, currency: string): { text: string; symbol: string | null } {
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] ?? null;
  const body =
    value >= 1
      ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(parseFloat(value.toPrecision(4)));
  return { text: `${symbol ?? ""}${body}`, symbol };
}

type Stage =
  | "capturing"
  | "ready"
  | "extracting"
  | "review"
  | "saving"
  | "watch-done"
  | "error";

const extractor = new PatternIntentExtractor();

/** Local fallback when the dashboard can't be reached. Never fails. */
const pageReader = new HeuristicPageReader();

export default function App() {
  const [stage, setStage] = useState<Stage>("capturing");
  const [capture, setCapture] = useState<PageCapture | null>(null);
  /** What kind of page this is. Null until the read lands, or if it never does. */
  const [reading, setReading] = useState<PageReading | null>(null);
  /** Set when the person asks to see a price we judged irrelevant. */
  const [priceForced, setPriceForced] = useState(false);
  /** A price the person corrected by hand. Overrides whatever we scraped. */
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [savedWatch, setSavedWatch] = useState<Watch | null>(null);

  useEffect(() => {
    void runCapture();
    void refreshWatches();
  }, []);

  /**
   * The capture everything else works from.
   *
   * A price the person corrected by hand is folded in here rather than at the
   * point it is displayed, so the instruction parser, the watch it creates and
   * the mandate it opens all agree with what is on screen. Correcting a number
   * that only changes the label would be worse than not offering to correct it.
   */
  const activeCapture: PageCapture | null =
    capture && priceOverride !== null && capture.primaryPrice
      ? {
          ...capture,
          primaryPrice: {
            ...capture.primaryPrice,
            value: priceOverride,
            raw: String(priceOverride),
            source: "corrected",
          },
        }
      : capture;

  async function refreshWatches() {
    setWatches(await listWatches());
  }

  async function runCapture() {
    setStage("capturing");
    setError(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      const url = tab.url ?? "";
      if (/^(chrome|edge|about|moz-extension|chrome-extension):/i.test(url)) {
        throw new Error("Browser pages can't be read. Open a normal website and try again.");
      }

      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePage,
      });

      const result = results[0]?.result as PageCapture | undefined;
      if (!result) throw new Error("The page returned nothing.");

      setCapture(result);
      setStage("ready");
      void runPageRead(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  /**
   * Ask what kind of page this is, in the background.
   *
   * Scraping can tell us a price-shaped string exists. It cannot tell us
   * whether a price means anything here, which is why the popup used to warn
   * about delivery on a token chart and announce a number on a news article.
   *
   * Deliberately not awaited by runCapture: the capture renders immediately
   * and this folds in when it lands. If it never lands, the UI stays in its
   * pre-reading state, which is the old behaviour and still usable.
   */
  async function runPageRead(target: PageCapture) {
    setReading(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6_000);
      try {
        const res = await fetch(`${APP_URL}/api/page-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capture: target }),
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { reading: PageReading };
          setReading(body.reading);
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
      setReading(await pageReader.read(target));
    } catch {
      // Offline or slow. The heuristic is local and cannot fail on network.
      try {
        setReading(await pageReader.read(target));
      } catch {
        /* leave unread; the card handles a null reading */
      }
    }
  }

  /**
   * Extraction prefers the dashboard's /api/intent (which may have a real
   * model behind it, key held server-side) and falls back to the local
   * pattern extractor when the dashboard is unreachable. The popup must never
   * depend on a server to function — offline capture-and-watch is the promise.
   */
  async function runExtract() {
    if (!activeCapture || !instruction.trim()) return;
    setStage("extracting");
    setActionError(null);

    const text = instruction.trim();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const res = await fetch(`${APP_URL}/api/intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capture: activeCapture, instruction: text }),
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { draft: IntentDraft };
          setDraft(body.draft);
          setStage("review");
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
      setDraft(await extractor.extract(activeCapture, text));
      setStage("review");
    } catch {
      try {
        setDraft(await extractor.extract(activeCapture, text));
        setStage("review");
      } catch {
        setError("Could not understand that instruction. Try rephrasing it.");
        setStage("error");
      }
    }
  }

  /**
   * Create a local watch. Permission is requested first and per-origin — the
   * background re-checks this page from the user's own browser, but that's no
   * reason to hold access to every site they visit.
   */
  async function startWatching() {
    if (!activeCapture || !draft) return;
    setActionError(null);

    let origin: string;
    try {
      origin = `${new URL(activeCapture.url).origin}/*`;
    } catch {
      setActionError("This page's address can't be watched.");
      return;
    }

    // Must be the first await in the click handler — Chrome ties permission
    // prompts to the user gesture.
    const granted = await browser.permissions.request({ origins: [origin] });
    if (!granted) {
      setActionError(
        "Auravis needs permission for this site to re-check the price. Nothing else is read.",
      );
      return;
    }

    setBusy(true);
    try {
      const basis = basisForTarget(draft.targetPercent !== null, draft.targetPrice !== null);
      const price = activeCapture.primaryPrice;
      const shipping = activeCapture.extraCosts?.shipping?.value ?? null;

      const watch: Watch = {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        url: activeCapture.url,
        title: activeCapture.title || activeCapture.url,
        basePrice: price?.value ?? draft.targetPrice ?? 0,
        baseDelivered: price && shipping !== null ? price.value + shipping : null,
        currency: price?.currency ?? "USD",
        basis,
        direction: draft.direction,
        targetPrice: draft.targetPrice,
        targetPercent: draft.targetPercent,
        intent: draft.rawInstruction,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000).toISOString(),
        lastCheckedAt: null,
        lastSeenPrice: price?.value ?? null,
        lastStock: activeCapture.availability === "out-of-stock" ? "out" : "unknown",
        status: "active",
        failures: 0,
      };

      await addWatch(watch);
      setSavedWatch(watch);
      await refreshWatches();
      setStage("watch-done");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save the watch.");
    } finally {
      setBusy(false);
    }
  }

  /** Hand the draft to the web app, where the user signs with their wallet. */
  async function createMandate() {
    if (!activeCapture || !draft) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${APP_URL}/api/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture: activeCapture, draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Server returned ${res.status}.`);
      }
      const { id } = (await res.json()) as { id: string };
      await browser.tabs.create({ url: `${APP_URL}/confirm/${id}` });
      window.close();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? `${err.message} Is the dashboard running at ${APP_URL}?`
          : "Could not reach the dashboard.",
      );
      setBusy(false);
    }
  }

  async function cancelWatch(id: string) {
    await updateWatch(id, { status: "cancelled" });
    await refreshWatches();
  }

  return (
    <main className="flex flex-col gap-4 p-5">
      <Header />

      {stage === "capturing" && <Capturing />}
      {stage === "error" && <ErrorState message={error} onRetry={runCapture} />}

      {(stage === "ready" || stage === "extracting") && activeCapture && (
        <>
          <CaptureCard
            capture={activeCapture}
            reading={reading}
            priceForced={priceForced}
            onForcePrice={() => setPriceForced(true)}
            onCorrectPrice={setPriceOverride}
          />
          <InstructionField
            value={instruction}
            onChange={setInstruction}
            onSubmit={runExtract}
            busy={stage === "extracting"}
          />
          <WatchList watches={watches} onCancel={cancelWatch} />
        </>
      )}

      {stage === "review" && draft && activeCapture && (
        <ReviewCard
          draft={draft}
          capture={activeCapture}
          busy={busy}
          actionError={actionError}
          onBack={() => setStage("ready")}
          onWatch={startWatching}
          onMandate={createMandate}
        />
      )}

      {stage === "watch-done" && savedWatch && (
        <WatchDone watch={savedWatch} onClose={() => window.close()} />
      )}
    </main>
  );
}

/**
 * The wordmark is the way home. Without this, the dashboard is a URL nobody
 * has — the extension is the front door, so the front door gets the signpost.
 */
function Header() {
  return (
    <header className="flex items-baseline justify-between px-1">
      <button
        type="button"
        onClick={() => void browser.tabs.create({ url: APP_URL })}
        title="Open your Auravis dashboard"
        className="group flex items-baseline gap-1.5 text-sm font-semibold tracking-tight text-ink"
      >
        Auravis
        <span className="text-xs text-ink-faint transition-colors group-hover:text-accent-bright">
          ↗ dashboard
        </span>
      </button>
      <span className="text-xs text-ink-faint">{NETWORK_LABEL}</span>
    </header>
  );
}

function Capturing() {
  return (
    <div className="glass-panel rise flex items-center gap-3 p-5">
      <span className="size-2 animate-pulse rounded-full bg-accent-bright" />
      <p className="text-sm text-ink-muted">Reading this page…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="glass-panel rise flex flex-col gap-4 p-5">
      <p className="note note-danger">{message ?? "Something went wrong."}</p>
      <button type="button" onClick={onRetry} className="btn-ghost px-3 py-2.5 text-sm">
        Try again
      </button>
    </div>
  );
}

/**
 * One panel, one hero. The price is the only large thing on screen; every
 * caveat is a single quiet line under a hairline. Warnings inform — they
 * don't get boxes to shout from.
 */
function CaptureCard({
  capture,
  reading,
  priceForced,
  onForcePrice,
  onCorrectPrice,
}: {
  capture: PageCapture;
  reading: PageReading | null;
  priceForced: boolean;
  onForcePrice: () => void;
  onCorrectPrice: (value: number | null) => void;
}) {
  const extra = capture.extraCosts;
  const shipping = extra?.shipping;
  const [correcting, setCorrecting] = useState(false);
  const [typed, setTyped] = useState("");

  /**
   * Whether to lead with the price at all.
   *
   * A price-shaped string exists on plenty of pages where it means nothing:
   * an article quoting last year's figure, a footer, a sidebar ad. Announcing
   * a number there is a confident wrong answer, which is worse than no answer.
   *
   * So the price only becomes the hero when the reading says it is something
   * a person could act on. Where it isn't, the number is still there behind a
   * button, because occasionally we are the ones who are wrong.
   */
  const priceIsRelevant = reading ? reading.priceIsActionable : true;
  // The correction is already folded into `capture` upstream, so everything
  // here and everything downstream see the same number.
  const price = priceIsRelevant || priceForced ? capture.primaryPrice : undefined;

  const money = price ? formatMoney(price.value, price.currency) : null;
  const symbol = money?.symbol;
  const landed = price && shipping ? price.value + shipping.value : null;

  /**
   * Other prices we saw on the page, in the order they appeared.
   *
   * Captured all along and never shown, which made "check it is the right one"
   * a dead end: we raised a doubt and gave nobody a way to settle it. The
   * candidates are usually the real answer sitting two places down the list.
   */
  const others = capture.priceCandidates
    .filter((c) => c !== price?.raw)
    .slice(0, 5);

  function commitTyped() {
    const value = Number(typed.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(value) && value > 0) onCorrectPrice(value);
    setCorrecting(false);
    setTyped("");
  }

  /**
   * Only mention delivery and tax where they could exist.
   *
   * Saying "delivery and tax not included" on a token chart is noise, and
   * noise makes the real warning on a shop page easier to ignore. Before, the
   * tell was stock keywords, which missed shops that don't use the phrase and
   * fired on articles that quote it. Now the page reading decides, and falls
   * back to the old heuristic only when no reading arrived.
   */
  const deliveryApplies = reading
    ? reading.deliveryApplies
    : capture.availability === "in-stock" || capture.availability === "out-of-stock";
  const taxAtCheckout = reading?.taxAtCheckout ?? extra?.taxAtCheckout ?? false;
  const showsShippingCaveat = Boolean(price && (deliveryApplies || taxAtCheckout));

  return (
    <section className="glass-panel rise flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          {hostname(capture.url)}
        </p>

        {price && money ? (
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {money.text}
            </span>
            {!symbol && <span className="text-sm text-ink-faint">{price.currency}</span>}
            {capture.availability === "out-of-stock" && (
              <span className="text-xs text-warn">out of stock</span>
            )}
          </div>
        ) : (
          <p className="pt-1 text-lg font-medium tracking-tight text-ink">
            {capture.title || "Untitled page"}
          </p>
        )}

        {price && (
          <p className="line-clamp-1 text-sm text-ink-muted">
            {reading?.subject || capture.title || "Untitled page"}
          </p>
        )}
      </div>

      <div className="hairline" />
      <div className="flex flex-col gap-1.5">
        {/* What the agent understood this page to be. The one line that shows
            it read the page rather than pattern-matched it. */}
        {reading?.note && <p className="note note-accent">{reading.note}</p>}

        {landed !== null ? (
          <p className="note">
            About {formatMoney(landed, price!.currency).text} delivered
            {taxAtCheckout && ", before tax"}
          </p>
        ) : showsShippingCaveat ? (
          <p className="note">
            {taxAtCheckout ? "Delivery and tax added at checkout" : "Delivery and tax not included"}
          </p>
        ) : null}

        {price?.source === "corrected" && (
          <p className="note note-accent">
            Using the price you set.{" "}
            <button
              type="button"
              onClick={() => onCorrectPrice(null)}
              className="underline underline-offset-2"
            >
              Undo
            </button>
          </p>
        )}

        {/* A guess, with a way out of it. The warning on its own only told
            someone their number might be wrong and left them there. */}
        {price?.source === "guessed" && (
          <>
            <p className="note note-warn">Price guessed from page text. Is this the right one?</p>

            {!correcting ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {others.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => {
                      const value = Number(candidate.replace(/[^0-9.]/g, ""));
                      if (Number.isFinite(value) && value > 0) onCorrectPrice(value);
                    }}
                    className="btn-ghost px-2 py-1 text-xs tabular-nums"
                  >
                    {candidate}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCorrecting(true)}
                  className="px-1 py-1 text-xs text-accent-bright underline underline-offset-2"
                >
                  {others.length ? "Type it" : "Set the price"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTyped();
                    if (e.key === "Escape") setCorrecting(false);
                  }}
                  placeholder={symbol ?? "$"}
                  inputMode="decimal"
                  className="field w-24 px-2 py-1 text-xs tabular-nums"
                />
                <button
                  type="button"
                  onClick={commitTyped}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  Use this
                </button>
              </div>
            )}
          </>
        )}

        {/* We found a number but judged it irrelevant. Say so, and offer it
            anyway rather than hiding a decision the person can overrule. */}
        {!price && capture.primaryPrice && (
          <button
            type="button"
            onClick={onForcePrice}
            className="self-start text-xs text-accent-bright underline underline-offset-2"
          >
            Show the {capture.primaryPrice.raw} on this page anyway
          </button>
        )}

        {!price && !capture.primaryPrice && (
          <p className="note">No price on this page. Name one in your instruction</p>
        )}
      </div>
    </section>
  );
}

function InstructionField({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <section className="rise rise-2 flex flex-col gap-2.5">
      <label htmlFor="instruction" className="px-1 text-xs font-medium text-ink-muted">
        What should happen?
      </label>
      <textarea
        id="instruction"
        rows={2}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        placeholder="buy $200 worth if it drops 8%"
        className="field resize-none p-3.5 text-sm leading-relaxed"
      />
      <button
        type="button"
        disabled={busy || value.trim().length === 0}
        onClick={onSubmit}
        className="btn-primary px-3 py-3 text-sm"
      >
        {busy ? "Reading…" : "Continue"}
      </button>
    </section>
  );
}

/**
 * The review screen decides which of the two promises we can honestly make:
 * Watch (any page, no wallet) or Watch & Buy (on-chain assets only). On an
 * ordinary shop a buy instruction downgrades to a watch, with the reason
 * stated in one quiet line rather than hidden.
 */
function ReviewCard({
  draft,
  capture,
  busy,
  actionError,
  onBack,
  onWatch,
  onMandate,
}: {
  draft: IntentDraft;
  capture: PageCapture;
  busy: boolean;
  actionError: string | null;
  onBack: () => void;
  onWatch: () => void;
  onMandate: () => void;
}) {
  const tradeable = isTradeablePage(capture.url);
  // A count is a complete instruction too. "buy 1 if it drops 8%" says exactly
  // what to do, and treating only a dollar figure as intent-to-buy meant those
  // people were told nothing was found.
  const wantsToBuy = draft.amount !== null || draft.quantity !== null;
  const unsure = draft.confidence < CONFIDENCE_FLOOR;

  const hasTarget = draft.targetPrice !== null || draft.targetPercent !== null;
  const basis: WatchBasis = basisForTarget(
    draft.targetPercent !== null,
    draft.targetPrice !== null,
  );

  const price = capture.primaryPrice;
  const shipping = capture.extraCosts?.shipping?.value ?? null;
  const delivered = price && shipping !== null ? price.value + shipping : null;
  const priceText = price ? formatMoney(price.value, price.currency).text : null;
  const symbol = (price && formatMoney(price.value, price.currency).symbol) ?? "$";

  const percentWithoutPrice = draft.targetPercent !== null && !price;
  const watchBlocked = !hasTarget || percentWithoutPrice || unsure;
  const mandateBlocked = watchBlocked || !wantsToBuy;

  // The hero: the one number this decision is about. Money first, then a
  // count, then whichever trigger we have — in the order a person would care.
  const hero =
    draft.amount !== null
      ? `$${draft.amount}`
      : draft.quantity !== null
        ? `${draft.quantity}`
        : draft.targetPrice !== null
          ? `${symbol}${draft.targetPrice}`
          : draft.targetPercent !== null
            ? `${draft.targetPercent}%`
            : "—";
  const heroCaption =
    draft.amount !== null
      ? tradeable
        ? "to spend, capped on-chain"
        : "to spend, once you confirm"
      : draft.quantity !== null
        ? draft.quantity === 1
          ? "to buy, once you confirm"
          : "to buy, once you confirm"
        : draft.direction === "below"
          ? "drop to watch for"
          : "rise to watch for";

  let targetLine: string | null = null;
  if (draft.targetPercent !== null && price) {
    const fireAt =
      draft.direction === "below"
        ? price.value * (1 - draft.targetPercent / 100)
        : price.value * (1 + draft.targetPercent / 100);
    targetLine = `${draft.targetPercent}% ${draft.direction === "below" ? "below" : "above"} the ${priceText} you see today. Alerts at ${formatMoney(fireAt, price.currency).text}`;
  } else if (draft.targetPrice !== null) {
    targetLine =
      basis === "delivered" && delivered !== null
        ? `Watching the delivered price (about ${symbol}${delivered.toFixed(2)} now) until it goes ${draft.direction} ${symbol}${draft.targetPrice}`
        : `Watching the listed price until it goes ${draft.direction} ${symbol}${draft.targetPrice}`;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="glass-panel rise flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {hero}
            </span>
            <span className="text-xs text-ink-faint">{heroCaption}</span>
          </div>
          <p className="line-clamp-2 text-sm text-ink-muted">{draft.summary}</p>
        </div>

        {(targetLine ||
          draft.assumptions.length > 0 ||
          (wantsToBuy && !tradeable) ||
          (basis === "delivered" && delivered === null && draft.targetPrice !== null)) && (
          <>
            <div className="hairline" />
            <div className="flex flex-col gap-1.5">
              {targetLine && <p className="note note-accent">{targetLine}</p>}

              {basis === "delivered" && delivered === null && draft.targetPrice !== null && (
                <p className="note note-warn">
                  Could not read delivery cost here, so watching the listed price instead
                </p>
              )}

              {wantsToBuy && !tradeable && (
                <p className="note">
                  Cannot buy from this shop. I will watch it and tell you the moment it
                  hits, so you buy in one click
                </p>
              )}

              {draft.assumptions.map((a) => (
                <p key={a} className="note">
                  {a}
                </p>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="rise rise-2 flex flex-col gap-2.5">
        {watchBlocked && (
          <p className="note note-warn px-1">
            {!hasTarget && "Name a price or a percentage so I know when to act"}
            {percentWithoutPrice &&
              "A percentage needs a starting price and this page did not give one. Use an exact price instead"}
            {unsure && hasTarget && !percentWithoutPrice && "I am not sure I understood. Try saying it another way"}
          </p>
        )}

        {actionError && <p className="note note-danger px-1">{actionError}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="btn-ghost flex-1 px-3 py-3 text-sm"
          >
            Back
          </button>
          {wantsToBuy && tradeable ? (
            <button
              type="button"
              disabled={mandateBlocked || busy}
              onClick={onMandate}
              className="btn-primary flex-1 px-3 py-3 text-sm"
            >
              {busy ? "Opening…" : "Create mandate"}
            </button>
          ) : (
            <button
              type="button"
              disabled={watchBlocked || busy}
              onClick={onWatch}
              className="btn-primary flex-1 px-3 py-3 text-sm"
            >
              {busy ? "Saving…" : "Start watching"}
            </button>
          )}
        </div>

        {wantsToBuy && tradeable && (
          <button
            type="button"
            disabled={watchBlocked || busy}
            onClick={onWatch}
            className="btn-ghost px-3 py-2 text-xs"
          >
            Just watch it instead
          </button>
        )}

        <p className="px-1 text-center text-xs text-ink-faint">
          {wantsToBuy && tradeable
            ? "The cap is enforced onchain. The agent cannot spend past it"
            : "Watched from your browser. This page never leaves your machine"}
        </p>
      </div>
    </section>
  );
}

function WatchDone({ watch, onClose }: { watch: Watch; onClose: () => void }) {
  const target = targetValue(watch);
  return (
    <section className="glass-panel rise flex flex-col items-center gap-3 p-6 text-center">
      <span className="dot dot-active" />
      <h2 className="text-lg font-semibold tracking-tight text-ink">Consider it watched</h2>
      <p className="line-clamp-2 text-sm text-ink-muted">{watch.title}</p>
      {target !== null && (
        <p className="note note-accent">
          You&apos;ll hear from me when the {watch.basis === "delivered" ? "delivered " : ""}
          price goes {watch.direction} {watch.currency === "USD" ? "$" : ""}
          {target.toFixed(2)}
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-faint">
        Checked every 30 minutes from this browser. Your region, your prices.
        <br />
        Nothing about this page leaves your machine.
      </p>
      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={() => void browser.tabs.create({ url: APP_URL })}
          className="btn-ghost flex-1 px-3 py-3 text-sm"
        >
          Open dashboard
        </button>
        <button type="button" onClick={onClose} className="btn-primary flex-1 px-3 py-3 text-sm">
          Done
        </button>
      </div>
    </section>
  );
}

function WatchList({
  watches,
  onCancel,
}: {
  watches: Watch[];
  onCancel: (id: string) => void;
}) {
  const visible = watches.filter((w) => w.status === "active" || w.status === "fired");
  if (visible.length === 0) return null;

  return (
    <section className="rise rise-3 flex flex-col gap-2">
      <p className="px-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
        Watching · {visible.length}
      </p>
      <ul className="glass-panel flex flex-col p-2">
        {visible.map((w, i) => (
          <li key={w.id}>
            {i > 0 && <div className="hairline mx-1" />}
            <div className="flex items-center gap-2.5 px-2 py-2">
              <span className={`dot ${w.status === "fired" ? "dot-fired" : "dot-active"}`} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{w.title}</span>
              {w.lastSeenPrice !== null && (
                <span className="shrink-0 text-xs text-ink-faint tabular-nums">
                  {w.currency === "USD" ? "$" : ""}
                  {w.lastSeenPrice.toFixed(2)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onCancel(w.id)}
                aria-label={`Stop watching ${w.title}`}
                className="shrink-0 px-1.5 text-xs text-ink-faint transition-colors hover:text-danger"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
