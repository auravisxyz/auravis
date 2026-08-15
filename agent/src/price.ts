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
 * The price endpoint is **POST, not GET** — a live probe returned
 * "Request method 'GET' not supported". It takes a batch of tokens in the
 * body, so one request covers every token we're watching rather than one
 * request per token.
 *
 * Signing confirmed working against the live API: the signature covers
 * timestamp + method + path + body, and for POST the body must be included
 * byte-for-byte as sent, or the signature won't match.
 */
export class OkxMarketPriceFeed implements PriceFeed {
  private readonly baseUrl = "https://web3.okx.com";
  private readonly path = "/api/v6/dex/market/price";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly apiPassphrase: string,
    private readonly projectId?: string,
    private readonly chainIndex = "196",
  ) {}

  async getPrice(token: string, vs = "USD"): Promise<number> {
    if (vs !== "USD") {
      throw new Error(`Quote currency "${vs}" not supported — prices are USD-denominated`);
    }
    const prices = await this.getPrices([token]);
    const price = prices.get(token.toLowerCase());
    if (price === undefined) {
      throw new Error(`OKX returned no price for ${token}`);
    }
    return price;
  }

  /**
   * Batch lookup. Returns a map keyed by lowercased contract address —
   * OKX echoes addresses back in its own casing, so normalising here saves
   * every caller from getting that subtly wrong.
   */
  async getPrices(tokens: string[]): Promise<Map<string, number>> {
    const payload = tokens.map((t) => ({
      chainIndex: this.chainIndex,
      tokenContractAddress: t,
    }));
    const body = JSON.stringify(payload);

    const timestamp = new Date().toISOString();
    const signature = await this.sign(timestamp, "POST", this.path, body);

    const res = await fetch(`${this.baseUrl}${this.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": this.apiKey,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": this.apiPassphrase,
        ...(this.projectId ? { "OK-ACCESS-PROJECT": this.projectId } : {}),
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`OKX Market API HTTP ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      code: string;
      msg?: string;
      data?: Array<{ tokenContractAddress?: string; price?: string }>;
    };

    if (json.code !== "0") {
      throw new Error(`OKX Market API error ${json.code}: ${json.msg ?? "unknown"}`);
    }

    const rows = json.data ?? [];
    const out = new Map<string, number>();

    // OKX does not reliably echo `tokenContractAddress` back — a live response
    // came back as just `[{"price":"0.999…"}]`. Keying solely off that field
    // meant a silently empty map: no price, no comparison, no fired trigger,
    // and nothing in the logs explaining it. Results are returned positionally,
    // so align by index and treat the echoed address as a cross-check when
    // it's actually there.
    rows.forEach((row, i) => {
      if (row.price === undefined) return;
      const value = Number(row.price);
      if (!Number.isFinite(value)) return;

      const requested = tokens[i];
      const echoed = row.tokenContractAddress?.toLowerCase();

      if (requested) out.set(requested.toLowerCase(), value);

      if (echoed && requested && echoed !== requested.toLowerCase()) {
        // Ordering assumption violated — trust the address, and say so loudly
        // rather than quietly pricing the wrong token.
        console.warn(
          `[price] OKX returned ${echoed} at index ${i} but we asked for ` +
            `${requested.toLowerCase()}. Keying by the returned address.`,
        );
        out.delete(requested.toLowerCase());
        out.set(echoed, value);
      }
    });

    if (rows.length !== tokens.length) {
      console.warn(
        `[price] asked for ${tokens.length} token(s), got ${rows.length} row(s) — ` +
          "positional alignment may be unreliable.",
      );
    }

    return out;
  }

  private async sign(
    timestamp: string,
    method: string,
    path: string,
    body = "",
  ): Promise<string> {
    const message = `${timestamp}${method}${path}${body}`;
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
  constructor(
    private prices: Record<string, number>,
    private fallback?: number,
  ) {}

  setPrice(token: string, price: number) {
    this.prices[token] = price;
  }

  async getPrice(token: string): Promise<number> {
    const price = this.prices[token] ?? this.fallback;
    if (price === undefined) throw new Error(`No mock price set for ${token}`);
    return price;
  }
}

export function createPriceFeed(): PriceFeed {
  const { apiKey, apiSecret, apiPassphrase, projectId } = config.okx;
  const haveCreds = Boolean(apiKey && apiSecret && apiPassphrase);

  if (config.priceFeed === "mock") {
    console.warn(
      `[price] PRICE_FEED=mock — every token reports $${config.mockPrice}. ` +
        "Local testing only; this bypasses OKX entirely.",
    );
    return new MockPriceFeed({}, config.mockPrice);
  }

  if (haveCreds) {
    return new OkxMarketPriceFeed(apiKey!, apiSecret!, apiPassphrase!, projectId);
  }

  if (config.priceFeed === "okx") {
    throw new Error("PRICE_FEED=okx but OKX credentials are not configured");
  }

  console.warn(
    "[price] OKX API credentials not set — using MockPriceFeed. " +
      "Set OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE in .env for real prices.",
  );
  return new MockPriceFeed({}, config.mockPrice);
}
