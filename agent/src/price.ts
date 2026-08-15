import { config } from "./config.js";

/**
 * A price feed the watch loop can poll. Kept as an interface so we can start
 * building against a mock today and swap in the real OKX Market API once
 * credentials are registered — without touching the watch loop at all.
 */
export interface PriceFeed {
  /** Latest price of `token`, quoted in `vs` (defaults to USD). */
  getPrice(token: string, vs?: string): Promise<number>;
}

/**
 * OKX Market API price feed.
 *
 * ⚠️ VERIFY BEFORE RELYING ON THIS (day 1 task): confirm the exact request
 * path, required headers, and signing method against
 * https://web3.okx.com/onchainos/dev-docs/market/market-price-reference
 * once OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE are issued. OKX's
 * v5 endpoints generally require the standard OK-ACCESS-* signed headers
 * even for read-only market data — this implementation assumes that and
 * will need its request signing double-checked against a live call.
 */
export class OkxMarketPriceFeed implements PriceFeed {
  private readonly baseUrl = "https://web3.okx.com";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly apiPassphrase: string,
    private readonly projectId?: string,
  ) {}

  async getPrice(token: string, vs = "USD"): Promise<number> {
    const path = `/api/v5/dex/market/price?chainIndex=196&tokenContractAddress=${token}`;
    const timestamp = new Date().toISOString();
    const signature = await this.sign(timestamp, "GET", path);

    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "OK-ACCESS-KEY": this.apiKey,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": this.apiPassphrase,
        ...(this.projectId ? { "OK-ACCESS-PROJECT": this.projectId } : {}),
      },
    });

    if (!res.ok) {
      throw new Error(`OKX Market API error ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as {
      code: string;
      data?: Array<{ price: string }>;
      msg?: string;
    };

    if (body.code !== "0" || !body.data?.[0]) {
      throw new Error(`OKX Market API returned no price: ${body.msg ?? "unknown error"}`);
    }

    const price = Number(body.data[0].price);
    if (vs !== "USD") {
      throw new Error(`Quote currency "${vs}" not supported yet — prices are USD-denominated`);
    }
    return price;
  }

  private async sign(timestamp: string, method: string, path: string): Promise<string> {
    const message = `${timestamp}${method}${path}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.apiSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return Buffer.from(sig).toString("base64");
  }
}

/**
 * A fixed/manual price feed for local development and demo rehearsal —
 * lets us trigger a mandate on cue without waiting for a real market move.
 */
export class MockPriceFeed implements PriceFeed {
  constructor(private prices: Record<string, number>) {}

  setPrice(token: string, price: number) {
    this.prices[token] = price;
  }

  async getPrice(token: string): Promise<number> {
    const price = this.prices[token];
    if (price === undefined) throw new Error(`No mock price set for ${token}`);
    return price;
  }
}

export function createPriceFeed(): PriceFeed {
  const { apiKey, apiSecret, apiPassphrase, projectId } = config.okx;
  if (apiKey && apiSecret && apiPassphrase) {
    return new OkxMarketPriceFeed(apiKey, apiSecret, apiPassphrase, projectId);
  }
  console.warn(
    "[price] OKX API credentials not set — using MockPriceFeed. " +
      "Set OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE in .env for real prices.",
  );
  return new MockPriceFeed({});
}
