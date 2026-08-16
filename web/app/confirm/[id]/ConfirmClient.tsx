"use client";

import { useEffect, useState } from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import type { IntentDraft, PageCapture } from "@auravis/shared";
import { activeChain, vaultAddress, tokens, auravisMandateAbi, network } from "@/lib/chain";

type Stage = "loading" | "ready" | "signing" | "done" | "error";

interface DraftRecord {
  id: string;
  capture: PageCapture;
  draft: IntentDraft;
  status: string;
}

export default function ConfirmClient({ draftId }: { draftId: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  // Editable because extraction is a suggestion, not a decision. Every value
  // that governs how much can be spent is the user's to set.
  const [spendSymbol, setSpendSymbol] = useState(tokens[0]?.symbol ?? "");
  const [buySymbol, setBuySymbol] = useState(tokens[1]?.symbol ?? "");
  const [amount, setAmount] = useState("");
  const [windowHours, setWindowHours] = useState("24");

  useEffect(() => {
    fetch(`/api/drafts/${draftId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Draft not found.");
        return r.json();
      })
      .then((data: DraftRecord) => {
        setRecord(data);
        if (data.draft.amount !== null) setAmount(String(data.draft.amount));
        setStage("ready");
      })
      .catch((e: Error) => {
        setError(e.message);
        setStage("error");
      });
  }, [draftId]);

  async function sign() {
    if (!record || !vaultAddress) return;
    setError(null);

    if (!window.ethereum) {
      setError("No wallet found. Install a browser wallet, then reload this page.");
      return;
    }

    const spend = tokens.find((t) => t.symbol === spendSymbol);
    const buy = tokens.find((t) => t.symbol === buySymbol);
    if (!spend || !buy) return setError("Pick both tokens.");
    if (spend.address === buy.address) return setError("Spend and buy tokens must differ.");

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return setError("Enter an amount greater than zero.");
    }

    setStage("signing");
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });

      // Wrong network is the most common failure here, and the revert it
      // causes is unreadable. Ask to switch before doing anything else.
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${activeChain.id.toString(16)}` }],
        });
      } catch {
        throw new Error(
          `Switch your wallet to ${activeChain.name} (chain ${activeChain.id}) and try again.`,
        );
      }

      const wallet = createWalletClient({ chain: activeChain, transport: custom(window.ethereum) });
      const publicClient = createPublicClient({ chain: activeChain, transport: http() });

      const [addr] = await wallet.getAddresses();
      if (!addr) throw new Error("No account available in the wallet.");
      setAccount(addr);

      // Only the vault owner can open a mandate. Checking here turns a raw
      // `NotOwner` revert into a sentence that explains itself.
      const onChainOwner = (await publicClient.readContract({
        address: vaultAddress,
        abi: auravisMandateAbi,
        functionName: "owner",
      })) as Address;

      if (onChainOwner.toLowerCase() !== addr.toLowerCase()) {
        throw new Error(
          `This vault is owned by ${onChainOwner.slice(0, 10)}…, but you're connected as ` +
            `${addr.slice(0, 10)}…. Only the owner can open a mandate.`,
        );
      }

      const cap = parseUnits(amount, spend.decimals);
      const windowSeconds = BigInt(Math.max(1, Math.round(Number(windowHours) * 3600)));

      // 0.99e18 — reject anything worse than ~1% off parity. The agent may
      // tighten this per swap but can never loosen it.
      const minOutPerUnit = 990_000_000_000_000_000n;

      const hash = await wallet.writeContract({
        address: vaultAddress,
        abi: auravisMandateAbi,
        functionName: "openMandate",
        args: [
          spend.address,
          buy.address,
          cap,
          cap, // window cap equals lifetime cap unless the user narrows it
          windowSeconds,
          0n, // no expiry
          minOutPerUnit,
          record.draft.rawInstruction,
        ],
        account: addr,
        chain: activeChain,
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let mandateId = "0";
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: auravisMandateAbi, ...log });
          if (decoded.eventName === "MandateOpened") {
            mandateId = String((decoded.args as unknown as { id: bigint }).id);
          }
        } catch {
          // Token and router logs won't decode against our ABI. Expected.
        }
      }

      await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandateId, txHash: hash }),
      });

      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed.");
      setStage("ready");
    }
  }

  if (stage === "loading") {
    return (
      <Shell>
        <p className="text-sm text-ink-muted">Loading…</p>
      </Shell>
    );
  }

  if (stage === "error" || !record) {
    return (
      <Shell>
        <p className="text-sm text-danger">{error ?? "Something went wrong."}</p>
      </Shell>
    );
  }

  if (stage === "done") {
    return (
      <Shell>
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">Mandate created</h2>
          <p className="text-sm text-ink-muted">
            The cap is now enforced on-chain. The agent can act inside it and nowhere else.
          </p>
          {txHash && (
            <a
              href={`${activeChain.blockExplorers?.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-accent underline"
            >
              {txHash}
            </a>
          )}
        </div>
      </Shell>
    );
  }

  const { draft, capture } = record;
  const busy = stage === "signing";

  return (
    <Shell>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <section className="flex flex-1 flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-faint">You asked for</p>
            <p className="pt-1 text-base text-ink sm:text-lg">{draft.summary}</p>
            <p className="truncate pt-2 text-xs text-ink-faint">{capture.url}</p>
          </div>

          {draft.assumptions.length > 0 && (
            <div className="flex flex-col gap-2 rounded-control bg-surface-raised p-3">
              <p className="text-xs font-medium text-warn">What was filled in for you</p>
              <ul className="flex flex-col gap-1">
                {draft.assumptions.map((a) => (
                  <li key={a} className="text-xs text-ink-muted">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Spend">
              <select
                value={spendSymbol}
                onChange={(e) => setSpendSymbol(e.target.value)}
                disabled={busy}
                className="w-full rounded-control border border-line bg-canvas p-2 text-sm text-ink"
              >
                {tokens.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Buy">
              <select
                value={buySymbol}
                onChange={(e) => setBuySymbol(e.target.value)}
                disabled={busy}
                className="w-full rounded-control border border-line bg-canvas p-2 text-sm text-ink"
              >
                {tokens.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Maximum to spend, ever">
              <input
                inputMode="decimal"
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="200"
                className="w-full rounded-control border border-line bg-canvas p-2 text-sm text-ink placeholder:text-ink-faint"
              />
            </Field>

            <Field label="Rate limit window (hours)">
              <input
                inputMode="numeric"
                value={windowHours}
                disabled={busy}
                onChange={(e) => setWindowHours(e.target.value)}
                className="w-full rounded-control border border-line bg-canvas p-2 text-sm text-ink"
              />
            </Field>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={sign}
            disabled={busy}
            className="rounded-control bg-accent px-4 py-3 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Confirm in your wallet…" : "Create mandate"}
          </button>

          {account && <p className="text-xs text-ink-faint">Connected as {account}</p>}
        </section>

        <aside className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-6 lg:w-80">
          <h2 className="text-sm font-medium text-ink">What this actually does</h2>
          <p className="text-xs leading-relaxed text-ink-muted">
            Signing writes a spending limit into a smart contract. The agent watching this
            page can spend up to that amount on {buySymbol || "the buy token"} and nothing
            else — it cannot exceed the cap, use a different router, or send the proceeds
            anywhere but this vault.
          </p>
          <p className="text-xs leading-relaxed text-ink-muted">
            You can revoke it or withdraw at any time without the agent&apos;s cooperation.
          </p>
          <p className="text-xs text-ink-faint">
            Network: {activeChain.name} ({network})
          </p>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex items-center justify-between pb-6">
        <h1 className="text-base font-semibold tracking-tight">Auravis</h1>
        <span className="text-xs text-ink-faint">{activeChain.name}</span>
      </header>
      {children}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
