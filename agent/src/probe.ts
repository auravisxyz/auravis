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

/** USDT on X Layer — replace if the token list says otherwise. */
const USDT_XLAYER = "0x1e4a5963abfd975d8c9021ce480b42188849d41d";

async function sign(timestamp: string, method: string, path: string, secret: string, body = "") {
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
    new TextEncoder().encode(`${timestamp}${method}${path}${body}`),
  );
  return Buffer.from(sig).toString("base64");
}

async function probe(label: string, path: string, method: "GET" | "POST" = "GET", payload?: unknown) {
  const { apiKey, apiSecret, apiPassphrase, projectId } = config.okx;
  if (!apiKey || !apiSecret || !apiPassphrase) {
    console.error("Missing OKX credentials in .env");
    process.exit(1);
  }

  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const signature = await sign(timestamp, method, path, apiSecret, body);

  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": apiPassphrase,
  };
  if (projectId) headers["OK-ACCESS-PROJECT"] = projectId;
  if (body) headers["Content-Type"] = "application/json";

  console.log(`\n=== ${label} ===`);
  console.log(`${method} ${path}`);
  if (body) console.log(`body:   ${body}`);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body ? { body } : {}),
    });
    const text = await res.text();
    console.log(`status: ${res.status}`);
    console.log(`resp:   ${text.slice(0, 600)}`);
  } catch (err) {
    console.log(`threw:  ${(err as Error).message}`);
  }
}

async function main() {
  // 1. Auth check — confirmed working, kept as a fast regression check.
  await probe("auth check — supported chains", "/api/v6/dex/aggregator/supported/chain");

  // 2. Tokens on X Layer, so we have real addresses to price and quote.
  await probe("X Layer token list", "/api/v6/dex/aggregator/all-tokens?chainIndex=196");

  // 3. Price — POST, not GET. Discovered the hard way.
  await probe("market price (POST)", "/api/v6/dex/market/price", "POST", [
    { chainIndex: "196", tokenContractAddress: USDT_XLAYER },
  ]);

  // 4. The real thing: does our PriceFeed implementation return a number?
  console.log("\n=== PriceFeed.getPrice() via the actual client ===");
  try {
    const { OkxMarketPriceFeed } = await import("./price.js");
    const { apiKey, apiSecret, apiPassphrase, projectId } = config.okx;
    const feed = new OkxMarketPriceFeed(apiKey!, apiSecret!, apiPassphrase!, projectId);
    const price = await feed.getPrice(USDT_XLAYER);
    console.log(`USDT on X Layer: $${price}`);
  } catch (err) {
    console.log(`threw: ${(err as Error).message}`);
  }

  // 5. THE DECISION POINT. Does the aggregator serve X Layer *testnet* (1952)?
  //    If not, a real OKX-routed execute() can only ever happen on mainnet,
  //    and the mainnet deploy has to move earlier than day 5 — it would be the
  //    single largest untested piece of the system.
  console.log("\n=== can we quote on TESTNET (1952)? ===");
  await probe(
    "swap quote — testnet 1952",
    `/api/v6/dex/aggregator/quote?chainIndex=1952&amount=1000000` +
      `&fromTokenAddress=${USDT_XLAYER}&toTokenAddress=0x0000000000000000000000000000000000000000`,
  );

  console.log("\n=== same quote on MAINNET (196), as a control ===");
  await probe(
    "swap quote — mainnet 196",
    `/api/v6/dex/aggregator/quote?chainIndex=196&amount=1000000` +
      `&fromTokenAddress=${USDT_XLAYER}&toTokenAddress=0x74b7f16337b8972027f6196a17a631ac6de26d22`,
  );
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
