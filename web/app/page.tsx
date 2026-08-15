import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { activeChain, vaultAddress, network } from "@/lib/chain";
import { readMandates, amount, type MandateView } from "@/lib/vault";

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

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1 pb-8 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Auravis</h1>
          <p className="pt-1 text-sm text-ink-muted">
            Limits your agent cannot argue its way past.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          {activeChain.name} · {network}
        </p>
      </header>

      {!vaultAddress && (
        <Notice tone="warn">
          No vault configured. Set <code>NEXT_PUBLIC_MANDATE_ADDRESS_{network.toUpperCase()}</code>{" "}
          in <code>web/.env.local</code>.
        </Notice>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink">Mandates</h2>
          {vaultAddress && (
            <a
              href={`${activeChain.blockExplorers?.default.url}/address/${vaultAddress}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-ink-faint underline"
            >
              {vaultAddress}
            </a>
          )}
        </div>

        {chainError ? (
          <Notice tone="danger">{chainError}</Notice>
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

      <section className="flex flex-col gap-3 pt-10">
        <h2 className="text-sm font-medium text-ink">What it did, and why</h2>
        {dbError ? (
          <Notice tone="danger">{dbError}</Notice>
        ) : executions.length === 0 ? (
          <Empty
            title="Nothing has happened yet"
            body="Every action and every refusal will be recorded here, in the agent's own words."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {executions.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-ink-faint">
                    mandate {e.mandateId.toString()}
                  </span>
                  <StatusPill status={e.status} />
                </div>
                {e.reason && <p className="text-sm text-ink-muted">{e.reason}</p>}
                {e.txHash && (
                  <a
                    href={`${activeChain.blockExplorers?.default.url}/tx/${e.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-accent underline"
                  >
                    {e.txHash}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Static width classes, one per twelfth.
 *
 * A progress bar wants a dynamic width, but RULES.md #3 rules out `style={{}}`
 * and arbitrary values. Snapping to twelfths keeps every value a real theme
 * class — imperceptible on a 4px bar, and the exact figures are spelled out in
 * text underneath anyway.
 */
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
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink">{mandate.intent || "Untitled mandate"}</p>
        <span
          className={
            mandate.active
              ? "shrink-0 rounded-control bg-surface-raised px-2 py-1 text-xs text-accent"
              : "shrink-0 rounded-control bg-surface-raised px-2 py-1 text-xs text-ink-faint"
          }
        >
          {mandate.active ? "active" : "closed"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="h-1 w-full overflow-hidden rounded-control bg-surface-raised">
          <div className={`h-full bg-accent ${fillClass(mandate.spent, mandate.lifetimeCap)}`} />
        </div>
        <p className="text-xs text-ink-muted">
          {amount(mandate.spent)} spent of {amount(mandate.lifetimeCap)} · {amount(remaining)} left
        </p>
        <p className="text-xs text-ink-faint">
          window {amount(mandate.windowSpent)} / {amount(mandate.windowCap)}
        </p>
      </div>

      <p className="text-xs text-ink-faint">
        The contract says: <span className="text-ink-muted">{mandate.check.why}</span>
      </p>
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "confirmed"
      ? "text-accent"
      : status === "reverted"
        ? "text-danger"
        : status === "skipped"
          ? "text-ink-faint"
          : "text-warn";
  return (
    <span className={`shrink-0 rounded-control bg-surface-raised px-2 py-1 text-xs ${tone}`}>
      {status}
    </span>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-dashed border-line p-6 text-center">
      <p className="text-sm text-ink">{title}</p>
      <p className="text-xs text-ink-muted">{body}</p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 text-sm ${
        tone === "danger" ? "text-danger" : "text-warn"
      }`}
    >
      {children}
    </div>
  );
}
