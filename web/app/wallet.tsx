"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
 */
interface WalletState {
  address: Address | null;
  isOwner: boolean;
  vaultOwner: Address | null;
  busy: boolean;
  connect: () => Promise<void>;
  switchWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [vaultOwner, setVaultOwner] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);

  // Rehydrate silently — eth_accounts never prompts.
  useEffect(() => {
    if (!window.ethereum) return;
    void window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const [first] = accounts as string[];
        if (first) setAddress(first as Address);
      })
      .catch(() => undefined);

    const onChange = (accounts: string[]) => setAddress((accounts[0] as Address) ?? null);
    window.ethereum.on?.("accountsChanged", onChange);
    return () => window.ethereum?.removeListener?.("accountsChanged", onChange);
  }, []);

  // The vault's owner, read once from the chain.
  useEffect(() => {
    if (!vaultAddress) return;
    const client = createPublicClient({ chain: activeChain, transport: http() });
    void client
      .readContract({ address: vaultAddress, abi: auravisMandateAbi, functionName: "owner" })
      .then((owner) => setVaultOwner(owner as Address))
      .catch(() => setVaultOwner(null));
  }, []);

  async function connect() {
    if (!window.ethereum) {
      window.open("https://web3.okx.com/download", "_blank", "noreferrer");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts[0]) setAddress(accounts[0] as Address);
    } catch {
      // Prompt dismissed — not an error.
    } finally {
      setBusy(false);
    }
  }

  async function switchWallet() {
    if (!window.ethereum) return;
    setBusy(true);
    try {
      // Forces the account picker even when already authorised.
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
      setAddress((accounts[0] as Address) ?? null);
    } catch {
      /* picker dismissed */
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await window.ethereum?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older wallets can't revoke; forgetting locally is still honest state.
    }
    setAddress(null);
  }

  const isOwner =
    address !== null &&
    vaultOwner !== null &&
    address.toLowerCase() === vaultOwner.toLowerCase();

  return (
    <WalletContext.Provider
      value={{ address, isOwner, vaultOwner, busy, connect, switchWallet, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}
