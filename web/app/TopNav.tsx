"use client";

import Link from "next/link";
import { activeChain } from "@/lib/chain";
import AutoRefresh from "./AutoRefresh";
import WalletMenu from "./WalletMenu";

/** Where the project lives publicly. One place to update when the domain lands. */
export const SOCIAL = {
  x: "https://x.com/auravisxyz",
  xHandle: "@auravisxyz",
};

/** Sticky glass bar. Wordmark left, state and wallet right. Nothing else. */
export default function TopNav() {
  return (
    <nav className="sticky top-0 z-10 border-b border-edge bg-canvas-deep/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="aura-mark" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-ink">Auravis</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:block">
            <AutoRefresh />
          </span>
          <span className="hidden text-xs text-ink-faint md:inline">{activeChain.name}</span>
          <WalletMenu />
        </div>
      </div>
    </nav>
  );
}
