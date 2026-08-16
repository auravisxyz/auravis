"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./wallet";
import { ArrowUpRightIcon, WalletIcon } from "./Icons";

/**
 * Asks which wallet, instead of guessing.
 *
 * Two situations land here. On desktop with several extensions installed,
 * each announces itself over EIP-6963 and we list them, because picking one
 * silently is how you end up connected as the wrong account. On mobile there
 * is usually no injected wallet at all, so the only way in is to reopen this
 * page inside a wallet's own browser, which is what the deep links do.
 */
export default function WalletPicker() {
  const { pickerOpen, closePicker, wallets, connect, busy } = useWallet();
  const [href, setHref] = useState("");

  useEffect(() => {
    setHref(window.location.href);
  }, []);

  // Escape closes, and while it's open the page behind shouldn't scroll.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  // Wallet in-app browsers take the bare host and path, no scheme.
  const bare = href.replace(/^https?:\/\//, "");
  const deepLinks = [
    { name: "OKX Wallet", url: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(href)}` },
    { name: "MetaMask", url: `https://metamask.app.link/dapp/${bare}` },
    { name: "Rainbow", url: `https://rnbwapp.com/dapp/${bare}` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-canvas-deep/80 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
      onClick={closePicker}
    >
      <div
        className="glass-panel rise w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            {wallets.length > 0 ? "Choose a wallet" : "Open in your wallet"}
          </h2>
          <button
            type="button"
            onClick={closePicker}
            className="btn-ghost px-2 py-1 text-xs"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        {wallets.length > 0 ? (
          <div className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <button
                key={wallet.uuid}
                type="button"
                disabled={busy}
                onClick={() => void connect(wallet)}
                className="btn-ghost flex items-center gap-3 p-3 text-left text-sm"
              >
                {/* Wallet-supplied data URI, per the EIP-6963 spec. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={wallet.icon} alt="" className="size-6 rounded-md" />
                <span className="font-medium text-ink">{wallet.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="mb-4 text-xs leading-relaxed text-ink-muted">
              Mobile browsers cannot talk to a wallet directly. Pick yours and this
              page reopens inside its built-in browser, where connecting works.
            </p>
            <div className="flex flex-col gap-2">
              {deepLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  className="btn-ghost flex items-center gap-3 p-3 text-sm"
                >
                  <span className="tile">
                    <WalletIcon className="size-4" />
                  </span>
                  <span className="font-medium text-ink">{link.name}</span>
                  <ArrowUpRightIcon className="ml-auto size-4 text-ink-faint" />
                </a>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              No wallet yet? Everything on this page is public onchain data, so you can
              read all of it without connecting.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
