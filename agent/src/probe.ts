import { config } from "./config.js";

/**
 * One-off probe for the OKX API. Exists because price.ts was written against
 * documentation rather than a live call, and the watch loop never exercises it
 * while there are zero triggers. Run with: npm run probe
 *
 * Prints raw status and body for each candidate endpoint so we can see exactly
 * what OKX returns — including error codes, which are more useful than a
 * thrown exception. Delete this once price.ts is confirmed.
 */

const BASE = "https://web3.okx.com";

async function sign(timestamp: string, method: string, path: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}${method}${path}`),
  );
  return Buffer.from(sig).toString("base64");
}

async function probe(label: string, path: string) {
  const { apiKey, apiSecret, apiPassphrase, projectId } = config.okx;
  if (!apiKey || !apiSecret || !apiPassphrase) {
    console.error("Missing OKX credentials in .env");
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const signature = await sign(timestamp, "GET", path, apiSecret);

  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": apiPassphrase,
  };
  if (projectId) headers["OK-ACCESS-PROJECT"] = projectId;

  console.log(`\n=== ${label} ===`);
  console.log(`GET ${path}`);
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    const body = await res.text();
    console.log(`status: ${res.status}`);
    console.log(`body:   ${body.slice(0, 600)}`);
  } catch (err) {
    console.log(`threw:  ${(err as Error).message}`);
  }
}

async function main() {
  // Paths below are v6 — confirmed against the Classic Swap API reference.
  // The earlier v5 guesses in this file were wrong.

  // 1. Cheapest auth check. If this fails, the problem is signing or
  //    credentials, not any specific endpoint — worth isolating.
  await probe("auth check — supported chains", "/api/v6/dex/aggregator/supported/chain");

  // 2. Tokens on X Layer. Gives us real contract addresses to quote against.
  await probe("X Layer token list", "/api/v6/dex/aggregator/all-tokens?chainIndex=196");

  // 3. Price feed — still unconfirmed, so try both plausible paths.
  await probe("market price v6", "/api/v6/dex/market/price?chainIndex=196");
  await probe("market price v5", "/api/v5/dex/market/price?chainIndex=196");
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
