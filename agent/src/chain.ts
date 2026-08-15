import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

/**
 * X Layer isn't in viem/chains, so we define both networks ourselves.
 * Verified against OKX's official developer docs, Aug 2026 — see CONTEXT.md.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testrpc.xlayer.tech/terigon"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.okx.com/web3/explorer/xlayer-test" },
  },
  testnet: true,
});

export const xLayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.okx.com/web3/explorer/xlayer" },
  },
  testnet: false,
});

export const activeChain = config.network === "mainnet" ? xLayerMainnet : xLayerTestnet;

export const agentAccount = privateKeyToAccount(config.agent.privateKey);

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
  account: agentAccount,
  chain: activeChain,
  transport: http(config.rpcUrl),
});
