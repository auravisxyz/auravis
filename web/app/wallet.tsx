"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPublicClient, http, type Address } from "viem";
import { activeChain, vaultAddress, auravisMandateAbi } from "@/lib/chain";

/**
 * One wallet state for the whole app.
 *
 * Previously each component read window.ethereum for itself, so the nav could
 * know you'd disconnected while the page carried on as if you hadn't — the
 * exact "no logged-out state" bug. Context makes disconnect mean disconnected
 * everywhere at once.
 *
 * Three states matter, not two:
 *   disconnected      — no address
 *   connected, viewer — an address that isn't the vault's owner
 *   connected, owner  — checked against the chain, never a stored flag
 *
 * Providers are discovered via EIP-6963 rather than read from window.ethereum.
 * That single slot is first-come-first-served: install two wallets and they
 * overwrite each other, so "connect" silently picks whichever won, with no way
 * to choose. 6963 has each wallet announce itself, so we can list them and let
 * the person decide. window.ethereum stays as a fallback for wallets that
 * haven't adopted the standard.
 */

export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193Provider;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (accounts: string[]) => void) => void;
  removeListener?: (event: string, handler: (accounts: string[]) => void) => void;
}

interface WalletState {
  address: Address | null;
  isOwner: boolean;
  vaultOwner: Address | null;
  busy: boolean;
  /** Every wallet that announced itself. Empty on most mobile browsers. */
  wallets: DiscoveredWallet[];
  /** True where no injected wallet exists and deep links are the only route. */
  needsMobileHandoff: boolean;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  /** No argument opens the picker when there's a real choice to make. */
  connect: (wallet?: DiscoveredWallet) => Promise<void>;
  switchWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

interface AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: Eip1193Provider;
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [vaultOwner, setVaultOwner] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** Whichever provider the person actually chose. All later calls use it. */
  const active = useRef<Eip1193Provider | null>(null);

  // Discovery. Wallets answer the request event, and late arrivals still
  // announce, so we keep listening rather than snapshotting once.
  useEffect(() => {
    const seen = new Map<string, DiscoveredWallet>();

    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as AnnounceEvent).detail;
      if (seen.has(info.rdns)) return;
      seen.set(info.rdns, { ...info, provider });
      setWallets([...seen.values()]);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  // Rehydrate silently. eth_accounts never prompts, so this restores a session
  // without a popup on every page load.
  useEffect(() => {
    const provider = active.current ?? wallets[0]?.provider ?? window.ethereum;
    if (!provider) return;

    void provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const [first] = accounts as string[];
        if (first) {
          active.current = provider;
          setAddress(first as Address);
        }
      })
      .catch(() => undefined);
  }, [wallets]);

  // Account changes from the wallet's own UI.
  useEffect(() => {
    const provider = active.current;
    if (!provider?.on) return;
    const onChange = (accounts: string[]) => {
      setAddress((accounts?.[0] as Address) ?? null);
    };
    provider.on("accountsChanged", onChange);
    return () => provider.removeListener?.("accountsChanged", onChange);
  }, [address]);

  // The vault's owner, read once from the chain.
  useEffect(() => {
    if (!vaultAddress) return;
    const client = createPublicClient({ chain: activeChain, transport: http() });
    void client
      .readContract({ address: vaultAddress, abi: auravisMandateAbi, functionName: "owner" })
      .then((owner) => setVaultOwner(owner as Address))
      .catch(() => setVaultOwner(null));
  }, []);

  const requestAccounts = useCallback(async (provider: Eip1193Provider) => {
    setBusy(true);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts[0]) {
        active.current = provider;
        setAddress(accounts[0] as Address);
      }
    } catch {
      // Prompt dismissed. Not an error.
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  }, []);

  const connect = useCallback(
    async (wallet?: DiscoveredWallet) => {
      if (wallet) return requestAccounts(wallet.provider);

      // One wallet: no decision to make, so don't invent one.
      const only = wallets[0];
      if (wallets.length === 1 && only) return requestAccounts(only.provider);
      if (wallets.length > 1) {
        setPickerOpen(true);
        return;
      }

      // Nothing announced. A legacy injected provider may still be there.
      if (window.ethereum) return requestAccounts(window.ethereum as Eip1193Provider);

      // Mobile browsers have no injected wallet at all. The picker shows the
      // deep links that reopen this page inside a wallet's own browser.
      setPickerOpen(true);
    },
    [wallets, requestAccounts],
  );

  const switchWallet = useCallback(async () => {
    const provider = active.current;
    if (!provider) return;
    setBusy(true);
    try {
      // Forces the account picker even when already authorised.
      await provider.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      setAddress((accounts[0] as Address) ?? null);
    } catch {
      /* picker dismissed */
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await active.current?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older wallets can't revoke; forgetting locally is still honest state.
    }
    active.current = null;
    setAddress(null);
  }, []);

  const isOwner =
    address !== null &&
    vaultOwner !== null &&
    address.toLowerCase() === vaultOwner.toLowerCase();

  return (
    <WalletContext.Provider
      value={{
        address,
        isOwner,
        vaultOwner,
        busy,
        wallets,
        needsMobileHandoff: wallets.length === 0,
        pickerOpen,
        openPicker: () => setPickerOpen(true),
        closePicker: () => setPickerOpen(false),
        connect,
        switchWallet,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
