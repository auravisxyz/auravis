import { config } from "./config.js";

/**
 * Authoritative token addresses for X Layer, straight from OKX.
 *
 * Written after a guessed USDT address silently passed every check: it was a
 * real, liquid token, so quotes succeeded — it just wasn't the USDT in the
 * user's wallet, which only showed up as a zero balance much later. Addresses
 * get looked up, never assumed.
 *
 * Run: npm run tokens
 */

const BASE = "https://web3.okx.com";
const PATH = "/api/v6/dex/aggregator/all-tokens?chainIndex=196";

async function sign(timestamp: string, method: string, path: string): Promise<string> {
  const secret = config.okx.apiSecret;
  if (!secret) throw new Error("OKX_API_SECRET is not set");
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

async function main() {
  const { apiKey, apiPassphrase, projectId } = config.okx;
  if (!apiKey || !apiPassphrase) {
    console.error("OKX credentials not configured.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": await sign(timestamp, "GET", PATH),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": apiPassphrase,
  };
  if (projectId) headers["OK-ACCESS-PROJECT"] = projectId;

  const res = await fetch(`${BASE}${PATH}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as {
    code: string;
    msg?: string;
    data?: Array<{
      tokenContractAddress?: string;
      tokenSymbol?: string;
      tokenName?: string;
      decimals?: string;
    }>;
  };
  if (body.code !== "0") throw new Error(`OKX error ${body.code}: ${body.msg ?? "unknown"}`);

  const tokens = body.data ?? [];
  console.log(`\nX Layer tokens known to the OKX aggregator: ${tokens.length}\n`);

  // Anything dollar-shaped — the naming varies (USDT, USDT0, USD₮0, bridged
  // variants), and picking the wrong one is exactly the mistake this fixes.
  const stables = tokens.filter((t) => /^(usd|usdt|usdc|usdg|dai)/i.test(t.tokenSymbol ?? ""));

  console.log("symbol        decimals  address");
  console.log("─".repeat(78));
  for (const t of stables) {
    console.log(
      `${(t.tokenSymbol ?? "?").padEnd(13)} ${(t.decimals ?? "?").padStart(8)}  ${t.tokenContractAddress}`,
    );
  }

  console.log(
    "\nMatch these against the contract address shown in your wallet\n" +
      "(tap the token → contract address), then set the pair you actually hold.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("tokens failed:", err);
  process.exit(1);
});
