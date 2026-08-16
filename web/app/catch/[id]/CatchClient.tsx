"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { tokens, network } from "@/lib/chain";

/**
 * Catch mode's second half: the agent caught the price, the human completes
 * the swap through OKX's own interface. This split is deliberate twice over —
 * the user keeps the final say, and interface-executed swaps are the ones
 * OKX counts toward builder volume (confirmed with their support: API-executed
 * swaps are excluded).
 *
 * The embedded widget is attempted dynamically. `@okxweb3/dex-widget`'s exact
 * mount API is UNVERIFIED against this version — so it's loaded defensively,
 * and failure lands on an honest fallback: open OKX DEX in a tab, swap there,
 * paste the transaction hash back. Clunky but true; a broken iframe pretending
 * to work would be neither.
 */

interface CatchRecord {
  id: number;
  status: string;
  reason: string | null;
  mandateId: string;
  trigger: { intent: string; amountIn: string; token: string; mode: string } | null;
}

type Stage = "loading" | "ready" | "confirming" | "done" | "error";

export default function CatchClient({ executionId }: { executionId: string }) {
  const [record, setRecord] = useState<CatchRecord | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [widgetLive, setWidgetLive] = useState(false);
  const [txHash, setTxHash] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/executions/${executionId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Not found.");
        return r.json();
      })
      .then((data: CatchRecord) => {
        setRecord(data);
        setStage(data.status === "pending" ? "ready" : "done");
      })
      .catch((e: Error) => {
        setError(e.message);
        setStage("error");
      });
  }, [executionId]);

  // Attempt the widget once the page is interactive. Every step optional-
  // chained: any missing export or thrown error simply leaves widgetLive
  // false and the fallback path visible.
  useEffect(() => {
    if (stage !== "ready" || !widgetRef.current || widgetLive) return;
    let cancelled = false;

    (async () => {
      try {
        // Indirect import: the package may not be installed yet (npm install
        // pending at daybreak), and a bare import would fail typecheck/build.
        const importer = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;
        const mod = (await importer("@okxweb3/dex-widget")) as Record<string, unknown>;
        const create =
          (mod.createOkxSwapWidget as ((el: HTMLElement, cfg: unknown) => unknown) | undefined) ??
          ((mod.default as Record<string, unknown> | undefined)?.createOkxSwapWidget as
            | ((el: HTMLElement, cfg: unknown) => unknown)
            | undefined);
        if (!create || cancelled || !widgetRef.current) return;

        create(widgetRef.current, {
          params: {
            chainIds: ["196"],
            theme: "dark",
            tradeType: "swap",
            inputChain: "196",
            outputChain: "196",
            inputCurrency: tokens[0]?.address,
            outputCurrency: tokens[1]?.address,
          },
          listeners: [
            {
              event: "ON_SUBMIT_TX",
              handler: (payload: { hash?: string; txHash?: string } | undefined) => {
                const hash = payload?.hash ?? payload?.txHash;
                if (hash) void confirm(hash);
              },
            },
          ],
        });
        if (!cancelled) setWidgetLive(true);
      } catch {
        // Fallback path stays visible. That's the design, not a failure state.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function confirm(hash: string) {
    setStage("confirming");
    setError(null);
    try {
      const res = await fetch(`/api/executions/${executionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not record it.");
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record it.");
      setStage("ready");
    }
  }

  const amount = record?.trigger ? (Number(record.trigger.amountIn) / 1e6).toFixed(2) : null;
  const validHash = /^0x[0-9a-fA-F]{64}$/.test(txHash.trim());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="text-xs text-ink-faint hover:text-ink">
        ← Back to dashboard
      </Link>

      {stage === "loading" && (
        <div className="glass-panel rise p-5">
          <p className="text-sm text-ink-muted">Loading…</p>
        </div>
      )}

      {stage === "error" && (
        <div className="glass-panel rise p-5">
          <p className="note note-danger">{error}</p>
        </div>
      )}

      {stage === "done" && (
        <section className="glass-panel rise flex flex-col items-center gap-3 p-6 text-center">
          <span className="dot dot-active" />
          <h1 className="text-lg font-semibold tracking-tight text-ink">Confirmed</h1>
          <p className="text-sm text-ink-muted">
            Recorded. The feed and the mandate's books are up to date.
          </p>
          <Link href="/" className="btn-primary px-4 py-2.5 text-sm">
            Back to dashboard
          </Link>
        </section>
      )}

      {(stage === "ready" || stage === "confirming") && record && (
        <>
          <section className="glass-panel rise flex flex-col gap-3 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              The agent caught it
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
                ${amount ?? "—"}
              </span>
              <span className="text-xs text-ink-faint">ready to swap · mandate {record.mandateId}</span>
            </div>
            {record.trigger && (
              <p className="text-sm text-ink-muted">&ldquo;{record.trigger.intent}&rdquo;</p>
            )}
            {record.reason && <p className="note">{record.reason}</p>}
            <p className="note note-accent">
              You confirm. You sign. Your wallet. The agent never touches this step.
            </p>
          </section>

          {/* The widget mounts here when it can. */}
          <div ref={widgetRef} className={widgetLive ? "glass-panel rise-2 overflow-hidden" : "hidden"} />

          {!widgetLive && (
            <section className="glass-panel rise rise-2 flex flex-col gap-3 p-5">
              <p className="text-sm text-ink">Complete the swap on OKX DEX</p>
              <a
                href={`https://web3.okx.com/dex-swap?inputChain=196&outputChain=196&inputCurrency=${tokens[0]?.address}&outputCurrency=${tokens[1]?.address}`}
                target="_blank"
                rel="noreferrer"
                className="btn-primary px-4 py-3 text-center text-sm"
              >
                Open OKX DEX ({network})
              </a>
              <div className="hairline" />
              <label htmlFor="txhash" className="text-xs text-ink-muted">
                Then paste the transaction hash to close the loop
              </label>
              <input
                id="txhash"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x…"
                className="field p-3 text-sm tabular-nums"
              />
              {error && <p className="note note-danger">{error}</p>}
              <button
                type="button"
                disabled={!validHash || stage === "confirming"}
                onClick={() => void confirm(txHash.trim())}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {stage === "confirming" ? "Recording…" : "Mark as completed"}
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
