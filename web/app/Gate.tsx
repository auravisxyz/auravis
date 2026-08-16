"use client";

import type { ReactNode } from "react";
import { useWallet } from "./wallet";
import { EyeIcon, VaultIcon, WalletIcon } from "./Icons";

/**
 * The three state front door.
 *
 * Disconnected: a hero, not a dashboard. Before this existed, signing out
 * changed nothing on screen, which made logout a lie.
 *
 * Connected but not the owner: data shows (chain state is public and hiding
 * it would be fake privacy) under a banner naming whose vault this is.
 *
 * Owner: everything.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const { address, isOwner, vaultOwner, busy, connect } = useWallet();

  if (!address) {
    // One pager: centers in whatever viewport remains under the nav, hero
    // words left, the door in on the right. Stacks on small screens and still
    // fits without scrolling.
    return (
      <section className="rise m-auto grid w-full max-w-4xl items-center gap-8 py-4 lg:grid-cols-2 lg:gap-14">
        {/* The brand mark lives in the nav; type and colour carry this side. */}
        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl">
            An agent that
            <br />
            shops for you.
            <br />
            <span className="text-aurora">A limit it can never break.</span>
          </h1>

          <p className="max-w-sm text-sm leading-relaxed text-ink-muted sm:text-base">
            Tell it what you want and your price. It watches day and night, then acts.
            Your limit is locked in a smart contract, so it can never spend more than
            you allow.
          </p>

          {/* The product's voice: real instructions people type into it. */}
          <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
            <span className="chip">&ldquo;buy $200 worth if it drops 8%&rdquo;</span>
            <span className="chip">&ldquo;tell me when it hits $40&rdquo;</span>
          </div>
        </div>

        <div className="glass-panel mx-auto flex w-full max-w-sm flex-col gap-5 p-6 lg:mx-0 lg:justify-self-end">
          <Feature icon={<EyeIcon className="size-4" />} title="Watches any page" text="All day, from your own browser" />
          <Feature icon={<VaultIcon className="size-4" />} title="Your limit lives onchain" text="A contract enforces it, not a prompt" />
          <Feature icon={<WalletIcon className="size-4" />} title="Your money stays yours" text="Take it back any time, no permission needed" />
          <div className="hairline" />
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="btn-primary flex items-center justify-center gap-2 px-4 py-3 text-sm"
          >
            <WalletIcon className="size-4" />
            {busy ? "Connecting…" : "Connect wallet"}
          </button>
          <p className="text-center text-xs text-ink-faint">
            No email. No password. Your wallet is your account.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      {!isOwner && (
        <div className="glass-panel rise mb-4 flex flex-col gap-1 p-4">
          <p className="note note-warn">
            You are viewing as {address.slice(0, 6)}…{address.slice(-4)}. This vault belongs
            to {vaultOwner ? `${vaultOwner.slice(0, 6)}…${vaultOwner.slice(-4)}` : "another wallet"}.
          </p>
          <p className="text-xs text-ink-faint">
            Onchain data is public, so you can look. Only the owner can open, revoke, or
            confirm anything.
          </p>
        </div>
      )}
      {children}
    </>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="tile">{icon}</span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-ink-faint">{text}</span>
      </span>
    </div>
  );
}
