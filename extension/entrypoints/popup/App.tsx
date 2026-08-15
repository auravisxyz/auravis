import { useEffect, useState } from "react";
import type { IntentDraft, PageCapture, WatchBasis } from "@auravis/shared";
import { PatternIntentExtractor, basisForTarget } from "@auravis/shared";
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

type Stage =
  | "capturing"
  | "ready"
  | "extracting"
  | "review"
  | "saving"
  | "watch-done"
  | "error";

const extractor = new PatternIntentExtractor();

export default function App() {
  const [stage, setStage] = useState<Stage>("capturing");
  const [capture, setCapture] = useState<PageCapture | null>(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  /**
   * Extraction prefers the dashboard's /api/intent (which may have a real
   * model behind it, key held server-side) and falls back to the local
   * pattern extractor when the dashboard is unreachable. The popup must never
   * depend on a server to function — offline capture-and-watch is the promise.
   */
  async function runExtract() {
    if (!capture || !instruction.trim()) return;
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
          body: JSON.stringify({ capture, instruction: text }),
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
      // Non-OK response falls through to the local extractor.
      setDraft(await extractor.extract(capture, text));
      setStage("review");
    } catch {
      try {
        setDraft(await extractor.extract(capture, text));
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
    if (!capture || !draft) return;
    setActionError(null);

    let origin: string;
    try {
      origin = `${new URL(capture.url).origin}/*`;
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
      const price = capture.primaryPrice;
      const shipping = capture.extraCosts?.shipping?.value ?? null;

      const watch: Watch = {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        url: capture.url,
        title: capture.title || capture.url,
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
        lastStock: capture.availability === "out-of-stock" ? "out" : "unknown",
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
    if (!capture || !draft) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${APP_URL}/api/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture, draft }),
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
    <main className="flex flex-col gap-3 p-4">
      <Header />

      {stage === "capturing" && <Capturing />}
      {stage === "error" && <ErrorState message={error} onRetry={runCapture} />}

      {(stage === "ready" || stage === "extracting") && capture && (
        <>
          <CaptureCard capture={capture} />
          <InstructionField
            value={instruction}
            onChange={setInstruction}
            onSubmit={runExtract}
            busy={stage === "extracting"}
          />
          <WatchList watches={watches} onCancel={cancelWatch} />
        </>
      )}

      {stage === "review" && draft && capture && (
        <ReviewCard
          draft={draft}
          capture={capture}
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

function Header() {
  return (
    <header className="flex items-center justify-between px-1">
      <h1 className="text-base font-semibold tracking-tight text-ink">Auravis</h1>
      <span className="glass-inset px-2 py-0.5 text-xs text-ink-faint">Testnet</span>
    </header>
  );
}

function Capturing() {
  return (
    <div className="glass-panel flex items-center gap-3 p-4">
      <span className="size-2 animate-pulse rounded-full bg-accent-bright" />
      <p className="text-sm text-ink-muted">Reading this page…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="glass-panel flex flex-col gap-3 p-4">
      <p className="text-sm text-danger">{message ?? "Something went wrong."}</p>
      <button type="button" onClick={onRetry} className="btn-ghost px-3 py-2 text-sm">
        Try again
      </button>
    </div>
  );
}

function CaptureCard({ capture }: { capture: PageCapture }) {
  return (
    <section className="glass-panel flex flex-col gap-2 p-4">
      <p className="line-clamp-2 text-sm font-medium text-ink">
        {capture.title || "Untitled page"}
      </p>
      <p className="truncate text-xs text-ink-faint">{capture.url}</p>

      {capture.primaryPrice ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold text-ink">{capture.primaryPrice.raw}</span>
            <span className="text-xs text-ink-faint">{capture.primaryPrice.currency}</span>
            {capture.availability === "out-of-stock" && (
              <span className="glass-inset px-2 py-0.5 text-xs text-warn">out of stock</span>
            )}
          </div>
          {capture.primaryPrice.source === "guessed" ? (
            <p className="text-xs text-warn">
              This page didn&apos;t state its price clearly — check it&apos;s the right one.
            </p>
          ) : (
            <p className="text-xs text-ink-faint">Read from the page&apos;s own product data.</p>
          )}
          <ExtraCostsNote capture={capture} />
        </div>
      ) : (
        <p className="pt-1 text-xs text-ink-faint">
          No price found on this page — you can still name one yourself.
        </p>
      )}
    </section>
  );
}

function ExtraCostsNote({ capture }: { capture: PageCapture }) {
  const extra = capture.extraCosts;
  const price = capture.primaryPrice;
  if (!extra || !price) return null;

  const shipping = extra.shipping;
  const symbol = price.raw.match(/[$£€¥]/)?.[0] ?? "";

  if (shipping) {
    const landed = price.value + shipping.value;
    return (
      <div className="glass-inset flex flex-col gap-1 p-2">
        <p className="text-xs text-ink">
          About {symbol}
          {landed.toFixed(2)} delivered{extra.taxAtCheckout && ", before tax"}
        </p>
        <p className="text-xs text-ink-faint">
          {price.raw} item + {shipping.raw} delivery
        </p>
      </div>
    );
  }

  return (
    <div className="glass-inset p-2">
      <p className="text-xs text-ink-muted">
        {extra.taxAtCheckout
          ? "Delivery and tax are added at checkout, so you'll pay more than this."
          : "Delivery and tax aren't included in this price."}
      </p>
    </div>
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
    <section className="flex flex-col gap-2">
      <label htmlFor="instruction" className="px-1 text-sm text-ink-muted">
        What should happen?
      </label>
      <textarea
        id="instruction"
        rows={3}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        placeholder="tell me if it drops 8% · buy $200 worth if it hits $40"
        className="field resize-none p-3 text-sm"
      />
      <button
        type="button"
        disabled={busy || value.trim().length === 0}
        onClick={onSubmit}
        className="btn-primary px-3 py-2.5 text-sm"
      >
        {busy ? "Reading…" : "Continue"}
      </button>
    </section>
  );
}

/**
 * The review screen decides which of the two promises we can honestly make:
 *
 *  - Watch: any page, no wallet, checked from this browser. Always available
 *    when there's a usable target.
 *  - Watch & Buy: only where the asset is genuinely on-chain. Offering a
 *    purchase on an ordinary shop would promise something we cannot do, so on
 *    those pages a buy instruction downgrades to a watch — with the reason
 *    stated, not hidden.
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
  const wantsToBuy = draft.amount !== null;
  const unsure = draft.confidence < CONFIDENCE_FLOOR;

  const hasTarget = draft.targetPrice !== null || draft.targetPercent !== null;
  const basis: WatchBasis = basisForTarget(
    draft.targetPercent !== null,
    draft.targetPrice !== null,
  );

  const price = capture.primaryPrice;
  const shipping = capture.extraCosts?.shipping?.value ?? null;
  const delivered = price && shipping !== null ? price.value + shipping : null;
  const symbol = price?.raw.match(/[$£€¥]/)?.[0] ?? "$";

  // Percent targets need a baseline to mean anything.
  const percentWithoutPrice = draft.targetPercent !== null && !price;
  const watchBlocked = !hasTarget || percentWithoutPrice || unsure;
  const mandateBlocked = watchBlocked || !wantsToBuy;

  // "8% below the $60.99 you saw today → alerts at $56.11"
  let targetLine: string | null = null;
  if (draft.targetPercent !== null && price) {
    const fireAt =
      draft.direction === "below"
        ? price.value * (1 - draft.targetPercent / 100)
        : price.value * (1 + draft.targetPercent / 100);
    targetLine = `${draft.targetPercent}% ${draft.direction === "below" ? "below" : "above"} the ${price.raw} you see today — alerts at ${symbol}${fireAt.toFixed(2)}.`;
  } else if (draft.targetPrice !== null) {
    targetLine =
      basis === "delivered" && delivered !== null
        ? `Watching the delivered price (about ${symbol}${delivered.toFixed(2)} right now) until it goes ${draft.direction} ${symbol}${draft.targetPrice}.`
        : `Watching the listed price until it goes ${draft.direction} ${symbol}${draft.targetPrice}.`;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="glass-panel flex flex-col gap-2 p-4">
        <p className="text-sm text-ink">{draft.summary}</p>
        {targetLine && <p className="text-xs text-accent-bright">{targetLine}</p>}
        {basis === "delivered" && delivered === null && draft.targetPrice !== null && (
          <p className="text-xs text-warn">
            Couldn&apos;t read delivery cost here, so this watches the listed price instead.
          </p>
        )}
      </div>

      {draft.assumptions.length > 0 && (
        <div className="glass-panel flex flex-col gap-2 p-4">
          <p className="text-xs font-medium text-warn">What I filled in for you</p>
          <ul className="flex flex-col gap-1">
            {draft.assumptions.map((a) => (
              <li key={a} className="text-xs text-ink-muted">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {wantsToBuy && !tradeable && (
        <div className="glass-inset p-3">
          <p className="text-xs text-ink-muted">
            I can&apos;t buy from this shop — no payment rails reach it. I can watch it from
            your browser and tell you the moment it hits your price, so you buy it yourself
            in one click.
          </p>
        </div>
      )}

      {watchBlocked && (
        <p className="px-1 text-xs text-warn">
          {!hasTarget && "I couldn't tell when to act — name a price or a percentage. "}
          {percentWithoutPrice &&
            "A percentage needs today's price as a baseline, and this page didn't give one — use an absolute price instead. "}
          {unsure && hasTarget && !percentWithoutPrice && "I'm not confident I understood that — try rephrasing. "}
        </p>
      )}

      {actionError && <p className="px-1 text-xs text-danger">{actionError}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onBack} disabled={busy} className="btn-ghost flex-1 px-3 py-2.5 text-sm">
          Back
        </button>
        {wantsToBuy && tradeable ? (
          <button
            type="button"
            disabled={mandateBlocked || busy}
            onClick={onMandate}
            className="btn-primary flex-1 px-3 py-2.5 text-sm"
          >
            {busy ? "Opening…" : "Create mandate"}
          </button>
        ) : (
          <button
            type="button"
            disabled={watchBlocked || busy}
            onClick={onWatch}
            className="btn-primary flex-1 px-3 py-2.5 text-sm"
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
          ? "The cap is enforced on-chain. The agent cannot spend past it."
          : "Watching happens in your browser. This page never leaves your machine."}
      </p>
    </section>
  );
}

function WatchDone({ watch, onClose }: { watch: Watch; onClose: () => void }) {
  const target = targetValue(watch);
  return (
    <section className="glass-panel flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <span className="dot dot-active" />
        <h2 className="text-base font-medium text-ink">Consider it watched</h2>
      </div>
      <p className="text-sm text-ink-muted">{watch.title}</p>
      {target !== null && (
        <p className="text-xs text-accent-bright">
          You&apos;ll hear from me when the {watch.basis === "delivered" ? "delivered " : ""}
          price goes {watch.direction} {watch.currency === "USD" ? "$" : ""}
          {target.toFixed(2)}.
        </p>
      )}
      <p className="text-xs text-ink-faint">
        Checked every 30 minutes from this browser — your region, your prices. Nothing about
        this page leaves your machine.
      </p>
      <button type="button" onClick={onClose} className="btn-primary px-3 py-2.5 text-sm">
        Done
      </button>
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
    <section className="glass-panel flex flex-col gap-2 p-3">
      <p className="px-1 text-xs font-medium text-ink-muted">Watching ({visible.length})</p>
      <ul className="flex flex-col gap-1">
        {visible.map((w) => (
          <li key={w.id} className="flex items-center gap-2 rounded-control px-1 py-1">
            <span className={`dot ${w.status === "fired" ? "dot-fired" : "dot-active"}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{w.title}</span>
            {w.lastSeenPrice !== null && (
              <span className="shrink-0 text-xs text-ink-faint">
                {w.currency === "USD" ? "$" : ""}
                {w.lastSeenPrice.toFixed(2)}
              </span>
            )}
            <button
              type="button"
              onClick={() => onCancel(w.id)}
              aria-label={`Stop watching ${w.title}`}
              className="shrink-0 px-1 text-xs text-ink-faint hover:text-danger"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
