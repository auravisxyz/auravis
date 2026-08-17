"use client";

import type { ReactNode } from "react";
import { activeChain, vaultAddress } from "@/lib/chain";
import { useWallet } from "./wallet";
import { ArrowUpRightIcon, WalletIcon } from "./Icons";

/**
 * The page for someone who has never heard of this.
 *
 * The fold is unchanged and still fits one viewport with no scrolling: the
 * claim, and one way in. Everything below exists because the claim is a big one
 * and nobody should be asked to take it on trust.
 *
 * Order is deliberate. Proof comes first, because two transactions are the only
 * thing here a competitor cannot also write. The problem comes second, once
 * someone has seen it work and is ready to ask why it matters. The demo key is
 * last, where a person convinced enough to touch it will be.
 *
 * Type sizes come from the scale in globals.css (.display, .section-title,
 * .lede, .card-title, .meta, .eyebrow) rather than being picked per element.
 * The first pass chose sizes ad hoc and everything landed within a step of
 * everything else, so nothing led the eye.
 */

const DEMO_KEY = "0xb9754e3366eff4f89cbb334188a170836e406dd5a5c30fa49d0667f21b61efb4";
const DEMO_VAULT = "0xAFABD7b4dDF492c1D9f1DD2aEe727697725F78Ff";

const PROOF = {
  executed: "0xbf431b339a4ff84c67851db2d2aac5744d8491acd49c3529ce8eaa6d6474300b",
  refused: "0x255068e702288bde4b5677111e75c2e5ef51c567756292636e3a7a89602ad456",
};

interface Stats {
  remaining: string | null;
  actions: number | null;
  refusals: number | null;
}

export default function Landing({ stats }: { stats?: Stats }) {
  const { busy, connect } = useWallet();
  const explorer = activeChain.blockExplorers?.default.url;

  return (
    <div className="flex flex-1 flex-col">
      {/* --- The fold. One viewport, no scrolling. --------------------------- */}
      <section className="rise mx-auto flex w-full max-w-5xl flex-1 items-center px-5 py-10 sm:px-6">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <h1 className="display text-ink">
              An agent that
              <br />
              shops for you.
              <br />
              <span className="text-aurora">A limit it can never break.</span>
            </h1>

            <p className="lede mt-5 text-ink-muted">
              Tell it what you want and your price. It watches day and night, then acts.
            </p>

            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:items-start">
              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy}
                className="btn-primary flex items-center justify-center gap-2 px-6 py-3.5 text-sm"
              >
                <WalletIcon className="size-4" />
                {busy ? "Connecting…" : "Connect wallet"}
              </button>
              <a
                href="#try"
                className="meta text-ink-faint transition-colors hover:text-ink"
              >
                or try it without one ↓
              </a>
            </div>
          </div>

          {/* The product in five seconds, before anyone clicks anything. */}
          <div className="glass-panel mx-auto w-full max-w-md p-6 lg:mx-0 lg:justify-self-end">
            <p className="eyebrow text-ink-faint">On any page, you type</p>
            <div className="mt-3.5 min-h-11 rounded-control border border-edge bg-canvas-deep/70 px-3.5 py-3">
              <span className="typewriter font-mono text-[0.8125rem] text-ink">
                buy 1 if it drops 8%
              </span>
              <span className="caret" aria-hidden />
            </div>

            <div className="parse-reveal mt-5">
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-semibold leading-none tracking-tight text-ink">
                  1
                </span>
                <span className="meta text-ink-faint">to buy, once you confirm</span>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <p className="meta text-accent-bright">
                  8% below the $89.99 you see today. Alerts at $82.79
                </p>
                <p className="meta text-ink-faint">
                  You will confirm before anything is bought
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Live strip. Real numbers, read off the chain. ------------------- */}
      <div className="border-y border-edge bg-canvas-deep/60 px-5 py-4 sm:px-6">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-8 gap-y-3.5 sm:grid-cols-4 sm:items-center">
          <div className="flex items-center gap-2.5">
            <span className="live-dot size-1.5 rounded-full bg-accent-bright" aria-hidden />
            <span className="meta text-ink-muted">Live on {activeChain.name}</span>
          </div>
          <Stat value={stats?.remaining ?? "—"} label="left of its cap" />
          <Stat value={stats?.actions?.toString() ?? "—"} label="actions recorded" />
          <Stat value={stats?.refusals?.toString() ?? "—"} label="refusals held" />
        </div>
      </div>

      {/* --- Proof. The strongest thing we have, on the brightest surface. --- */}
      <Band tone="paper">
        <p className="eyebrow text-[var(--color-paper-ink-faint)]">Proof, not claims</p>
        <h2 className="section-title mt-2">Same agent. Same key. One minute apart.</h2>

        <div className="mt-9 grid gap-5 md:grid-cols-2">
          <ProofCard
            tone="good"
            label="Executed on its own"
            headline="It found a fair price and bought, unattended."
            figure="4 USDT"
            figureLabel="spent, 3.998 USDC received"
            href={explorer ? `${explorer}/tx/${PROOF.executed}` : undefined}
            hash="0xbf431b33"
          />
          <ProofCard
            tone="bad"
            label="Refused by the contract"
            headline="We offered it a bad price and told it to buy anyway."
            figure="0.90"
            figureLabel="offered, against a floor of 0.99"
            href={explorer ? `${explorer}/tx/${PROOF.refused}` : undefined}
            hash="0x255068e7"
          />
        </div>

        <p className="lede mt-8 text-[var(--color-paper-ink-muted)]">
          It had permission. It was inside its cap. It still could not move the money,
          because the price was wrong.
        </p>
      </Band>

      {/* --- Three steps. --------------------------------------------------- */}
      <Band tone="pure" bordered>
        <h2 className="section-title">Three steps, then close the laptop</h2>
        <ol className="mt-9 grid gap-8 sm:grid-cols-3 sm:gap-6">
          <Step n="01" accent="var(--color-paper-accent)" title="Point at any page">
            A product, a token, a listing
          </Step>
          <Step n="02" accent="oklch(0.66 0.15 252)" title="Say it in plain English">
            And set the limit it cannot pass
          </Step>
          <Step n="03" accent="oklch(0.82 0.07 250)" title="Walk away">
            It watches, acts, and writes down why
          </Step>
        </ol>
      </Band>

      {/* --- The problem. Dark, because it should feel like one. ------------- */}
      <section className="relative overflow-hidden bg-canvas-deep px-5 py-16 sm:px-6 sm:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(58% 78% at 88% 0%, oklch(0.55 0.2 27 / 0.17), transparent 62%)",
          }}
        />
        <div className="relative mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="section-title text-ink">
              In May, an AI wallet was drained of $180,000.
            </h2>
            <p className="lede mt-5 text-ink-muted">
              Not a hack. Someone hid an instruction inside a public social media reply.
              The agent read it, and did what it was told.
            </p>
          </div>

          <div className="glass-panel p-6">
            <p className="eyebrow text-ink-faint">Every other agent&rsquo;s limit</p>
            <p className="mt-3 text-[0.9375rem] italic leading-relaxed text-ink-muted">
              &ldquo;You must never spend more than $500.&rdquo;
            </p>
            <div className="hairline my-5" />
            <p className="eyebrow text-ink-faint">Ours</p>
            <pre className="mt-3 overflow-x-auto font-mono text-[0.8125rem] leading-relaxed text-accent-bright">
{`if (declaredIn > remaining)
  revert ExceedsLifetimeCap();`}
            </pre>
          </div>
        </div>
      </section>

      {/* --- What it will not do. ------------------------------------------- */}
      <Band tone="paper">
        <h2 className="section-title">What it will not do</h2>
        <p className="meta mt-2.5 text-[var(--color-paper-ink-faint)]">
          Worth saying plainly.
        </p>
        <div className="mt-9 grid gap-7 sm:grid-cols-3 sm:gap-6">
          <Limit title="Buy from ordinary shops">
            It watches those and tells you the moment, for now.
          </Limit>
          <Limit title="Hold your money">
            It stays in your vault, and you can take it back without asking anyone.
          </Limit>
          <Limit title="Be talked past its cap">
            Not by us, not by the agent, not by a hidden instruction.
          </Limit>
        </div>
      </Band>

      {/* --- Try it. -------------------------------------------------------- */}
      <section
        id="try"
        className="band-paper-pure scroll-mt-16 border-t border-[var(--color-paper-line)] px-5 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="section-title">Try it without a wallet of your own</h2>
            <p className="lede mt-5 text-[var(--color-paper-ink-muted)]">
              Every vault has exactly one owner, so connecting your own wallet here would
              only ever let you look. This is a second vault on testnet, with a key
              published on purpose. Import it and you own that one.
            </p>
            <p className="meta mt-3 text-[var(--color-paper-ink-faint)]">
              Testnet only, holding mock tokens. Nothing on it is worth anything.
            </p>
          </div>

          <div className="paper-card p-6">
            <p className="eyebrow text-[var(--color-paper-ink-faint)]">Demo key</p>
            <p className="mt-3 break-all font-mono text-xs leading-relaxed text-[var(--color-paper-ink-muted)]">
              {DEMO_KEY}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(DEMO_KEY)}
                className="rounded-control bg-[var(--color-paper-ink)] px-5 py-2.5 text-[0.8125rem] font-medium text-[var(--color-paper-pure)] transition-opacity hover:opacity-90"
              >
                Copy key
              </button>
              {explorer && (
                <a
                  href={`${explorer}/address/${DEMO_VAULT}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-control border border-[var(--color-paper-line)] px-5 py-2.5 text-[0.8125rem] text-[var(--color-paper-ink-muted)] transition-colors hover:border-[var(--color-paper-ink-faint)]"
                >
                  See the vault
                  <ArrowUpRightIcon className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* --- Close. --------------------------------------------------------- */}
      <section className="bg-canvas-deep px-5 py-16 text-center sm:px-6">
        <p className="mx-auto max-w-lg text-lg font-medium leading-snug tracking-tight text-ink sm:text-xl">
          An agent that shops for you. A limit it can never break.
        </p>
        {vaultAddress && explorer && (
          <a
            href={`${explorer}/address/${vaultAddress}`}
            target="_blank"
            rel="noreferrer"
            className="meta mt-4 inline-flex items-center gap-1.5 text-ink-faint transition-colors hover:text-accent-bright"
          >
            Read the contract on {activeChain.name}
            <ArrowUpRightIcon className="size-3.5" />
          </a>
        )}
      </section>
    </div>
  );
}

/** One shell for the light bands, so padding and width never drift. */
function Band({
  tone,
  bordered,
  children,
}: {
  tone: "paper" | "pure";
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`${tone === "paper" ? "band-paper" : "band-paper-pure"} ${
        bordered ? "border-t border-[var(--color-paper-line)]" : ""
      } px-5 py-16 sm:px-6 sm:py-24`}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[0.9375rem] font-semibold tabular-nums text-ink">{value}</span>
      <span className="meta text-ink-faint">{label}</span>
    </div>
  );
}

/**
 * The pair that carries the whole argument. Each leads with the number, because
 * that is the part a skimmer reads, and the number is the thing that differs.
 */
function ProofCard({
  tone,
  label,
  headline,
  figure,
  figureLabel,
  href,
  hash,
}: {
  tone: "good" | "bad";
  label: string;
  headline: string;
  figure: string;
  figureLabel: string;
  href?: string;
  hash: string;
}) {
  const accent = tone === "good" ? "var(--color-paper-good)" : "var(--color-paper-bad)";
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <span className="eyebrow" style={{ color: accent }}>
          {label}
        </span>
      </div>

      <p className="card-title mt-4">{headline}</p>

      <div className="mt-6 flex items-baseline gap-2.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{figure}</span>
        <span className="meta text-[var(--color-paper-ink-faint)]">{figureLabel}</span>
      </div>

      <div className="mt-5 border-t border-[var(--color-paper-line)] pt-4">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--color-paper-accent)]">
          {hash}
          <ArrowUpRightIcon className="size-3" />
        </span>
      </div>
    </>
  );

  const className = "paper-card proof-card paper-card-link block p-6";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} style={{ borderLeftColor: accent }}>
      {body}
    </a>
  ) : (
    <div className={className} style={{ borderLeftColor: accent }}>
      {body}
    </div>
  );
}

function Step({
  n,
  accent,
  title,
  children,
}: {
  n: string;
  accent: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li>
      <div className="h-0.5 w-full rounded-full" style={{ backgroundColor: accent }} />
      <p className="eyebrow mt-4 text-[var(--color-paper-ink-faint)]">{n}</p>
      <p className="card-title mt-2">{title}</p>
      <p className="meta mt-2 text-[var(--color-paper-ink-muted)]">{children}</p>
    </li>
  );
}

function Limit({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-[var(--color-paper-line)] pt-4">
      <p className="card-title">{title}</p>
      <p className="meta mt-2 text-[var(--color-paper-ink-muted)]">{children}</p>
    </div>
  );
}
