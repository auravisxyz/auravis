"use client";

import { useState } from "react";
import { useWallet } from "./wallet";

/** The nav's wallet control. All state lives in WalletProvider. */
export default function WalletMenu() {
  const { address, isOwner, busy, switchWallet, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  // Disconnected: render nothing. The hero carries the one connect button —
  // two competing CTAs for the same action is one too many.
  if (!address) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost flex items-center gap-2 px-3 py-1.5 text-xs"
        aria-expanded={open}
      >
        {isOwner && <span className="dot dot-active" />}
        <span className="tabular-nums">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        {isOwner && <span className="text-accent-bright">owner</span>}
        <span className="text-ink-faint">▾</span>
      </button>

      {open && (
        <div className="glass-panel absolute right-0 top-full z-20 mt-2 flex w-44 flex-col p-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void switchWallet();
            }}
            disabled={busy}
            className="rounded-control px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-raised"
          >
            Switch wallet
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
            className="rounded-control px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-surface-raised"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
