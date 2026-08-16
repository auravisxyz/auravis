"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeChain, vaultAddress } from "@/lib/chain";
import { SOCIAL } from "./TopNav";
import { HomeIcon, ActivityIcon, VaultIcon, XLogoIcon } from "./Icons";
import type { ReactNode } from "react";

/**
 * Mobile bottom bar, hidden from `sm` up where the top nav and footer carry
 * the same destinations. Real icons, one accent for where you are.
 */
export default function BottomNav() {
  const pathname = usePathname();
  const explorer = activeChain.blockExplorers?.default.url;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-edge bg-canvas-deep/80 backdrop-blur-xl sm:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        <Item href="/" label="Home" active={pathname === "/"}>
          <HomeIcon className="size-5" />
        </Item>
        <Item href="/#activity" label="Activity">
          <ActivityIcon className="size-5" />
        </Item>
        {vaultAddress && explorer && (
          <Item href={`${explorer}/address/${vaultAddress}`} label="Vault" external>
            <VaultIcon className="size-5" />
          </Item>
        )}
        <Item href={SOCIAL.x} label="Follow" external>
          <XLogoIcon className="size-4" />
        </Item>
      </div>
    </nav>
  );
}

function Item({
  href,
  label,
  children,
  active,
  external,
}: {
  href: string;
  label: string;
  children: ReactNode;
  active?: boolean;
  external?: boolean;
}) {
  const className = `flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
    active ? "text-accent-bright" : "text-ink-faint hover:text-ink"
  }`;
  const body = (
    <>
      {children}
      <span className="text-xs">{label}</span>
    </>
  );

  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
