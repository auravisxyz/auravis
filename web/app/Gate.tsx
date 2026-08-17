"use client";

import type { ReactNode } from "react";
import { useWallet } from "./wallet";
import Landing from "./Landing";

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
export default function Gate({
  children,
  stats,
}: {
  children: ReactNode;
  stats?: { remaining: string | null; actions: number | null; refusals: number | null };
}) {
  const { address, isOwner, vaultOwner } = useWallet();

  // Full bleed: the landing's light bands must reach the window edges, and the
  // dashboard's container is capped at max-w-5xl. Rendering it here rather than
  // inside that container is cheaper than fighting the width with viewport
  // tricks that break the moment a scrollbar appears.
  if (!address) return <Landing stats={stats} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
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
    </div>
  );
}

