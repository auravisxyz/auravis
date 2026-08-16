import { activeChain, vaultAddress, network } from "@/lib/chain";
import { SOCIAL } from "./TopNav";
import { XLogoIcon, VaultIcon, BoltIcon } from "./Icons";

/**
 * One slim row, always present on desktop: follow the build, verify the
 * contract, know the network. Compact on purpose so the landing stays a one
 * pager. Mobile carries these destinations in the bottom nav instead.
 */
export default function Footer() {
  const explorer = activeChain.blockExplorers?.default.url;

  return (
    <footer className="hidden border-t border-edge sm:block">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="aura-mark" aria-hidden />
          <span className="text-xs text-ink-faint">
            {network === "testnet" ? "X Layer testnet · test tokens only" : "X Layer mainnet"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <FooterLink href={SOCIAL.x} icon={<XLogoIcon className="size-3.5" />}>
            {SOCIAL.xHandle}
          </FooterLink>
          {vaultAddress && explorer && (
            <FooterLink
              href={`${explorer}/address/${vaultAddress}`}
              icon={<VaultIcon className="size-3.5" />}
            >
              Vault on OKLink
            </FooterLink>
          )}
          <FooterLink href="https://web3.okx.com/xlayer" icon={<BoltIcon className="size-3.5" />}>
            Built on X Layer
          </FooterLink>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-accent-bright"
    >
      {icon}
      {children}
    </a>
  );
}
