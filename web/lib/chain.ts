import { defineChain, type Address } from "viem";

export { auravisMandateAbi } from "./abi";

export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.okx.com/web3/explorer/xlayer" },
  },
});

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.okx.com/web3/explorer/xlayer-test" },
  },
  testnet: true,
});

const NETWORK = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const activeChain = NETWORK === "mainnet" ? xLayer : xLayerTestnet;

export const vaultAddress = (
  NETWORK === "mainnet"
    ? process.env.NEXT_PUBLIC_MANDATE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MANDATE_ADDRESS_TESTNET
) as Address | undefined;

/**
 * Tokens the confirm screen offers. Mainnet addresses come from OKX's token
 * list. X Layer testnet has no equivalent liquid stablecoins, which is why a
 * real swap can only be demonstrated on mainnet — the testnet entries exist so
 * the signing flow can be exercised, not so it can trade.
 */
export interface TokenOption {
  symbol: string;
  address: Address;
  decimals: number;
}

export const TOKENS: Record<"mainnet" | "testnet", TokenOption[]> = {
  mainnet: [
    { symbol: "USDT", address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", decimals: 6 },
    { symbol: "USDC", address: "0x74b7f16337b8972027f6196a17a631ac6de26d22", decimals: 6 },
  ],
  testnet: [
    { symbol: "USDT (test)", address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", decimals: 6 },
    { symbol: "USDC (test)", address: "0x74b7f16337b8972027f6196a17a631ac6de26d22", decimals: 6 },
  ],
};

export const tokens = TOKENS[NETWORK];
export const network = NETWORK;
