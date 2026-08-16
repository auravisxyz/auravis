import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { activeChain, vaultAddress, network } from "@/lib/chain";
import { readMandates, amount, type MandateView } from "@/lib/vault";
import Gate from "./Gate";

// The chain moves; don't serve a stale view of someone's spending limits.
export const revalidate = 0;

export default async function Dashboard() {
  let mandates: MandateView[] = [];
  let chainError: string | null = null;
  try {
    mandates = await readMandates();
  } catch (err) {
    chainError = err instanceof Error ? err.message : "Could not reach the chain.";
  }

  let executions: (typeof schema.executions.$inferSelect)[] = [];
  let dbError: string | null = null;
  try {
    executions = await getDb()
      .select()
      .from(schema.executions)
      .orderBy(desc(schema.executions.createdAt))
      .limit(20);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Could not reach the database.";
  }

  const active = mandates.filter((m) => m.active);
  const totalRemaining = active.reduce((sum, m) => sum + (m.lifetimeCap - m.spent), 0n);
  const explorer = activeChain.blockExplorers?.default.url;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <Gate>
      <div className="flex flex-col gap-8">
      {/* ---- The three numbers that matter -------------------------------- */}
      <section className="rise rise-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Active mandates" value={String(active.length)} />
        <Stat label="Agent can still spend" value={`$${amount(totalRemaining)}`} />
        <Stat label="Actions recorded" value={String(executions.length)} />
      </section>

      {!vaultAddress && (
        <p className="note note-warn">
          No vault configured. Set NEXT_PUBLIC_MANDATE_ADDRESS_{network.toUpperCase()} in
          web/.env.local
        </p>
      )}

      {/* ---- Mandates ------------------------------------------------------ */}
      <section className="rise rise-2 flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Mandates
          </h2>
          {vaultAddress && explorer && (
            <a
              href={`${explorer}/address/${vaultAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-faint underline-offset-2 transition-colors hover:text-accent-bright hover:underline"
            >
              vault {vaultAddress.slice(0, 6)}…{vaultAddress.slice(-4)} ↗
            </a>
          )}
        </div>

        {chainError ? (
          <p className="note note-danger px-1">{chainError}</p>
        ) : mandates.length === 0 ? (
          <Empty
            title="No mandates yet"
            body="Capture a page with the extension and confirm it here. Nothing can be spent until you sign one."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {mandates.map((m) => (
              <MandateCard key={m.id} mandate={m} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- The feed ------------------------------------------------------ */}
      <section id="activity" className="rise rise-3 flex flex-col gap-3 scroll-mt-20">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
          What it did, and why
        </h2>

        {dbError ? (
          <p className="note note-danger px-1">{dbError}</p>
        ) : executions.length === 0 ? (
          <Empty
            title="Nothing has happened yet"
            body="Every action and every refusal is recorded here, in the agent's own words."
          />
        ) : (
          <ul className="glass-panel flex flex-col p-2">
            {executions.map((e, i) => (
              <li key={e.id}>
                {i > 0 && <div className="hairline mx-2" />}
                <FeedEntry entry={e} explorer={explorer} />
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      </Gate>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel flex flex-col gap-1 p-5">
      <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-3xl">
        {value}
      </span>
      <span className="text-xs text-ink-faint">{label}</span>
    </div>
  );
}

/** Static twelfth-widths — RULES.md #3 rules out style={{}} and arbitrary values. */
const FILL_CLASSES = [
  "w-0",
  "w-1/12",
  "w-2/12",
  "w-3/12",
  "w-4/12",
  "w-5/12",
  "w-6/12",
  "w-7/12",
  "w-8/12",
  "w-9/12",
  "w-10/12",
  "w-11/12",
  "w-full",
] as const;

function fillClass(spent: bigint, cap: bigint): string {
  if (cap === 0n) return FILL_CLASSES[0];
  const twelfths = Number((spent * 12n) / cap);
  return FILL_CLASSES[Math.min(Math.max(twelfths, 0), 12)] ?? FILL_CLASSES[0];
}

function MandateCard({ mandate }: { mandate: MandateView }) {
  const remaining = mandate.lifetimeCap - mandate.spent;

  return (
    <li className="glass-panel flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-sm text-ink-muted">
          {mandate.intent || "Untitled mandate"}
        </p>
        <span
          className={`shrink-0 text-xs ${mandate.active ? "text-accent-bright" : "text-ink-faint"}`}
        >
          {mandate.active ? "active" : "closed"}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
          ${amount(remaining)}
        </span>
        <span className="text-xs text-ink-faint">left of ${amount(mandate.lifetimeCap)}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="h-1 w-full overflow-hidden rounded-control bg-surface-raised">
          <div className={`h-full bg-accent ${fillClass(mandate.spent, mandate.lifetimeCap)}`} />
        </div>
        <p className="text-xs text-ink-faint tabular-nums">
          window ${amount(mandate.windowSpent)} / ${amount(mandate.windowCap)}
        </p>
      </div>

      <div className="hairline" />
      <p className={`note ${mandate.check.allowed ? "" : "note-warn"}`}>
        The contract says: {mandate.check.why}
      </p>
    </li>
  );
}

function FeedEntry({
  entry,
  explorer,
}: {
  entry: typeof schema.executions.$inferSelect;
  explorer: string | undefined;
}) {
  const tone =
    entry.status === "confirmed"
      ? "dot-active"
      : entry.status === "reverted"
        ? "dot-danger"
        : entry.status === "skipped"
          ? "dot-dead"
          : "dot-fired";

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <div className="flex items-center gap-2.5">
        <span className={`dot ${tone}`} />
        <span className="text-xs font-medium text-ink">{entry.status}</span>
        <span className="text-xs text-ink-faint">mandate {entry.mandateId.toString()}</span>
        <span className="flex-1" />
        <span className="text-xs text-ink-faint">{relativeTime(entry.createdAt)}</span>
      </div>
      {entry.reason && (
        <p className="pl-4 text-sm leading-relaxed text-ink-muted">{entry.reason}</p>
      )}
      {entry.status === "pending" && (
        <Link
          href={`/catch/${entry.id}`}
          className="pl-4 text-xs font-medium text-accent-bright underline-offset-2 hover:underline"
        >
          Review &amp; confirm →
        </Link>
      )}
      {entry.txHash && explorer && (
        <a
          href={`${explorer}/tx/${entry.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="pl-4 text-xs text-accent-bright underline-offset-2 hover:underline tabular-nums"
        >
          {entry.txHash.slice(0, 10)}…{entry.txHash.slice(-8)} ↗
        </a>
      )}
    </div>
  );
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-dashed border-line p-8 text-center">
      <p className="text-sm text-ink">{title}</p>
      <p className="mx-auto max-w-md text-xs text-ink-muted">{body}</p>
    </div>
  );
}
