"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { tokens, network } from "@/lib/chain";

/**
 * Catch mode's second half: the agent caught the price, the human completes
 * the swap through OKX's own interface. This split is deliberate twice over.
 * The user keeps the final say, and interface-executed swaps are the ones OKX
 * counts toward builder volume (confirmed with their support: API-executed
 * swaps are excluded).
 *
 * We hand off to OKX DEX in a new tab rather than embedding their widget.
 * `@okxweb3/dex-widget` pins React 18 as a peer and this app runs React 19, so
 * installing it needs --legacy-peer-deps and would break a clean CI build for a
 * component whose mount API we never verified. The handoff routes through the
 * same interface, so nothing about volume attribution changes. Clunky but true;
 * a broken iframe pretending to work would be neither.
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
  const [txHash, setTxHash] = useState("");

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
        </>
      )}
    </main>
  );
}
