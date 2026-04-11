/**
 * Unit tests — no live API required.
 * Run with: npm run test:unit
 */

import { createHmac } from "crypto";
import { BudaClient, BudaApiError } from "../src/client.js";
import { MemoryCache } from "../src/cache.js";
import { validateMarketId } from "../src/validation.js";
import { handlePlaceOrder } from "../src/tools/place_order.js";
import { handleCancelOrder } from "../src/tools/cancel_order.js";
import { flattenAmount, getLiquidityRating } from "../src/utils.js";
import { handleArbitrageOpportunities } from "../src/tools/arbitrage.js";
import { handleMarketSummary } from "../src/tools/market_summary.js";

// ----------------------------------------------------------------
// Minimal test harness
// ----------------------------------------------------------------

let passed = 0;
let failed = 0;

function section(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ----------------------------------------------------------------
// a. HMAC signing — assert exact output for a known input/key/nonce
// ----------------------------------------------------------------

section("a. HMAC-SHA384 signing");

await test("GET with no body: sign string is 'METHOD PATH NONCE'", () => {
  const secret = "test-api-secret";
  const nonce = "1712000000000000";
  const method = "GET";
  const path = "/api/v2/markets.json";

  // Expected: compute independently using raw crypto
  const expected = createHmac("sha384", secret)
    .update(`${method} ${path} ${nonce}`)
    .digest("hex");

  // Actual: via BudaClient (access private method through subclass)
  class TestableClient extends BudaClient {
    testSign(m: string, p: string, body: string, n: string): string {
      return (this as unknown as { sign: (m: string, p: string, b: string, n: string) => string }).sign(m, p, body, n);
    }
  }
  const client = new TestableClient(undefined, "test-api-key", secret);
  const actual = client.testSign(method, path, "", nonce);

  assertEqual(actual, expected, "HMAC signature");
});

await test("POST with body: sign string includes base64-encoded body", () => {
  const secret = "another-secret";
  const nonce = "9999999999999999";
  const method = "POST";
  const path = "/api/v2/markets/btc-clp/orders.json";
  const body = JSON.stringify({ type: "Bid", amount: 0.001 });

  const encodedBody = Buffer.from(body).toString("base64");
  const expected = createHmac("sha384", secret)
    .update(`${method} ${path} ${encodedBody} ${nonce}`)
    .digest("hex");

  class TestableClient extends BudaClient {
    testSign(m: string, p: string, b: string, n: string): string {
      return (this as unknown as { sign: (m: string, p: string, b: string, n: string) => string }).sign(m, p, b, n);
    }
  }
  const client = new TestableClient(undefined, "test-api-key", secret);
  const actual = client.testSign(method, path, body, nonce);

  assertEqual(actual, expected, "HMAC signature with body");
});

await test("signing is deterministic for the same inputs", () => {
  class TestableClient extends BudaClient {
    testSign(m: string, p: string, b: string, n: string): string {
      return (this as unknown as { sign: (m: string, p: string, b: string, n: string) => string }).sign(m, p, b, n);
    }
  }
  const client = new TestableClient(undefined, "key", "secret");
  const sig1 = client.testSign("GET", "/api/v2/tickers.json", "", "12345");
  const sig2 = client.testSign("GET", "/api/v2/tickers.json", "", "12345");
  assertEqual(sig1, sig2, "deterministic signature");
});

// ----------------------------------------------------------------
// b. Cache deduplication — fetcher called exactly once for concurrent requests
// ----------------------------------------------------------------

section("b. Cache in-flight deduplication");

await test("concurrent getOrFetch calls share the same in-flight promise", async () => {
  const cache = new MemoryCache();
  let fetchCount = 0;

  const slowFetcher = async (): Promise<string> => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 20));
    return "result";
  };

  // Fire three concurrent requests for the same key
  const [r1, r2, r3] = await Promise.all([
    cache.getOrFetch("key", 5000, slowFetcher),
    cache.getOrFetch("key", 5000, slowFetcher),
    cache.getOrFetch("key", 5000, slowFetcher),
  ]);

  assertEqual(fetchCount, 1, "fetcher call count");
  assertEqual(r1, "result", "result 1");
  assertEqual(r2, "result", "result 2");
  assertEqual(r3, "result", "result 3");
});

await test("after expiry, fetcher is called again", async () => {
  const cache = new MemoryCache();
  let fetchCount = 0;

  const fetcher = async (): Promise<number> => ++fetchCount;

  await cache.getOrFetch("k", 1, fetcher); // ttl = 1ms, expires immediately
  await new Promise((r) => setTimeout(r, 5));
  await cache.getOrFetch("k", 1, fetcher);

  assertEqual(fetchCount, 2, "fetcher called twice after expiry");
});

await test("rejected fetcher clears in-flight entry so next call retries", async () => {
  const cache = new MemoryCache();
  let fetchCount = 0;

  const failingFetcher = async (): Promise<string> => {
    fetchCount++;
    throw new Error("transient error");
  };

  try {
    await cache.getOrFetch("fail-key", 5000, failingFetcher);
  } catch {
    // expected
  }

  const okFetcher = async (): Promise<string> => {
    fetchCount++;
    return "recovered";
  };

  const result = await cache.getOrFetch("fail-key", 5000, okFetcher);
  assertEqual(result, "recovered", "recovered after failure");
  assertEqual(fetchCount, 2, "fetcher called twice (once failed, once succeeded)");
});

// ----------------------------------------------------------------
// c. confirmation_token guard — place_order and cancel_order
// ----------------------------------------------------------------

section("c. confirmation_token guard");

await test("place_order returns isError:true without 'CONFIRM'", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handlePlaceOrder(
    {
      market_id: "BTC-CLP",
      type: "Bid",
      price_type: "limit",
      amount: 0.001,
      limit_price: 60_000_000,
      confirmation_token: "yes",
    },
    fakeClient,
  );
  assert(result.isError === true, "isError should be true");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "error code");
});

await test("place_order returns isError:true with empty confirmation_token", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handlePlaceOrder(
    {
      market_id: "BTC-CLP",
      type: "Ask",
      price_type: "market",
      amount: 0.005,
      confirmation_token: "",
    },
    fakeClient,
  );
  assert(result.isError === true, "isError should be true for empty token");
});

await test("cancel_order returns isError:true without 'CONFIRM'", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleCancelOrder(
    { order_id: 12345, confirmation_token: "cancel" },
    fakeClient,
  );
  assert(result.isError === true, "isError should be true");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "error code");
});

await test("cancel_order returns isError:true with no token", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleCancelOrder(
    { order_id: 99, confirmation_token: "" },
    fakeClient,
  );
  assert(result.isError === true, "isError should be true for empty token");
});

// ----------------------------------------------------------------
// d. Input sanitization — malformed market IDs return isError:true
// ----------------------------------------------------------------

section("d. Input sanitization — validateMarketId");

await test("rejects path traversal", () => {
  assert(validateMarketId("../../etc/passwd") !== null, "should reject path traversal");
});

await test("rejects no-hyphen input", () => {
  assert(validateMarketId("BTCCLP") !== null, "should reject missing hyphen");
});

await test("rejects empty string", () => {
  assert(validateMarketId("") !== null, "should reject empty string");
});

await test("rejects segment too long (>10 chars)", () => {
  assert(validateMarketId("ABCDEFGHIJK-CLP") !== null, "should reject 11-char base segment");
});

await test("rejects segment too short (<2 chars)", () => {
  assert(validateMarketId("B-CLP") !== null, "should reject 1-char base segment");
});

await test("accepts standard market ID (uppercase)", () => {
  assertEqual(validateMarketId("BTC-CLP"), null, "BTC-CLP should be valid");
});

await test("accepts lowercase market ID", () => {
  assertEqual(validateMarketId("eth-btc"), null, "eth-btc should be valid (case-insensitive)");
});

await test("accepts USDC quote currency", () => {
  assertEqual(validateMarketId("BTC-USDC"), null, "BTC-USDC should be valid");
});

await test("rejects special characters", () => {
  assert(validateMarketId("BTC-CL$") !== null, "should reject $ in market ID");
});

// ----------------------------------------------------------------
// e. 429 retry — mock 429 then 200, assert fetch called twice
// ----------------------------------------------------------------

section("e. 429 Retry-After retry logic");

await test("retries once on 429 and returns 200 data", async () => {
  const savedFetch = globalThis.fetch;
  let callCount = 0;

  const mockData = { ticker: { market_id: "BTC-CLP", last_price: ["65000000", "CLP"] } };

  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify({}), {
        status: 429,
        headers: { "Retry-After": "0" }, // 0 seconds = no actual wait in tests
      });
    }
    return new Response(JSON.stringify(mockData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await client.get<typeof mockData>("/markets/btc-clp/ticker");
    assertEqual(callCount, 2, "fetch should be called exactly twice");
    assertEqual(result.ticker.market_id, "BTC-CLP", "result should match mock data");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("throws BudaApiError with retryAfterMs when second attempt also returns 429", async () => {
  const savedFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    return new Response(JSON.stringify({}), {
      status: 429,
      headers: { "Retry-After": "0" },
    });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    try {
      await client.get("/markets/btc-clp/ticker");
      assert(false, "should have thrown BudaApiError");
    } catch (err) {
      assert(err instanceof BudaApiError, "should throw BudaApiError");
      assertEqual((err as BudaApiError).status, 429, "status should be 429");
      assert((err as BudaApiError).retryAfterMs !== undefined, "retryAfterMs should be set");
    }
    assertEqual(callCount, 2, "fetch should be called exactly twice");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("Retry-After header parsed as seconds (RFC 7231): '2' header = 2000ms wait", async () => {
  const savedFetch = globalThis.fetch;
  const delays: number[] = [];
  const savedSetTimeout = globalThis.setTimeout;

  // Capture the delay value passed to setTimeout
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    delays.push(ms);
    return savedSetTimeout(fn, 0); // execute immediately in test
  }) as typeof setTimeout;

  let callCount = 0;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
    }
    return new Response(JSON.stringify({ markets: [] }), { status: 200 });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    await client.get("/markets");
    const retryDelay = delays[0];
    assertEqual(retryDelay, 2000, "Retry-After: 2 should produce 2000ms delay");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
  }
});

await test("defaults to 1000ms when Retry-After header is absent", async () => {
  const savedFetch = globalThis.fetch;
  const delays: number[] = [];
  const savedSetTimeout = globalThis.setTimeout;

  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    delays.push(ms);
    return savedSetTimeout(fn, 0);
  }) as typeof setTimeout;

  let callCount = 0;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response("{}", { status: 429 }); // no Retry-After header
    }
    return new Response(JSON.stringify({ markets: [] }), { status: 200 });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    await client.get("/markets");
    const retryDelay = delays[0];
    assertEqual(retryDelay, 1000, "missing Retry-After should default to 1000ms");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
  }
});

// ----------------------------------------------------------------
// f. Numeric flattening — flattenAmount returns typed float, not string
// ----------------------------------------------------------------

section("f. Numeric flattening — flattenAmount");

await test("flattenAmount returns a number value, not a string", () => {
  const result = flattenAmount(["65000000", "CLP"]);
  assert(typeof result.value === "number", "value should be a number");
  assertEqual(result.value, 65000000, "value should equal 65000000");
  assertEqual(result.currency, "CLP", "currency should equal CLP");
});

await test("flattenAmount handles decimal strings correctly", () => {
  const result = flattenAmount(["4.99123456", "BTC"]);
  assert(typeof result.value === "number", "value should be a number");
  assertEqual(result.value, 4.99123456, "value should equal 4.99123456");
  assertEqual(result.currency, "BTC", "currency should equal BTC");
});

await test("flattenAmount on zero amount", () => {
  const result = flattenAmount(["0.0", "CLP"]);
  assertEqual(result.value, 0, "zero should parse to 0");
});

await test("flattenAmount value is not a string array", () => {
  const result = flattenAmount(["65000000", "CLP"]);
  assert(!Array.isArray(result), "result should not be an array");
  assert(typeof result.value !== "string", "value should not be a string");
});

// ----------------------------------------------------------------
// g. get_arbitrage_opportunities — discrepancy calculation
// ----------------------------------------------------------------

section("g. get_arbitrage_opportunities — discrepancy calculation");

await test("correctly computes USDC-normalized price discrepancy between CLP and PEN markets", async () => {
  const savedFetch = globalThis.fetch;

  // BTC-CLP: 65000000 CLP, USDC-CLP: 1000 CLP → BTC in USDC = 65000
  // BTC-PEN: 250000000 PEN, USDC-PEN: 3700 PEN → BTC in USDC ≈ 67567.567...
  // Discrepancy: (67567.567 - 65000) / 65000 * 100 ≈ 3.95%
  const mockTickers = {
    tickers: [
      { market_id: "BTC-CLP", last_price: ["65000000", "CLP"], max_bid: ["64900000", "CLP"], min_ask: ["65100000", "CLP"], volume: ["4.99", "BTC"], price_variation_24h: "0.01", price_variation_7d: "0.05" },
      { market_id: "BTC-PEN", last_price: ["250000000", "PEN"], max_bid: ["249500000", "PEN"], min_ask: ["250500000", "PEN"], volume: ["1.5", "BTC"], price_variation_24h: "0.012", price_variation_7d: "0.04" },
      { market_id: "USDC-CLP", last_price: ["1000", "CLP"], max_bid: ["999", "CLP"], min_ask: ["1001", "CLP"], volume: ["100", "USDC"], price_variation_24h: "0.001", price_variation_7d: "0.002" },
      { market_id: "USDC-PEN", last_price: ["3700", "PEN"], max_bid: ["3695", "PEN"], min_ask: ["3705", "PEN"], volume: ["50", "USDC"], price_variation_24h: "0.001", price_variation_7d: "0.002" },
    ],
  };

  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockTickers), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleArbitrageOpportunities(
      { base_currency: "BTC", threshold_pct: 0.5 },
      client,
      cache,
    );

    assert(!result.isError, "should not return an error");
    const parsed = JSON.parse(result.content[0].text) as {
      opportunities: Array<{ market_a: string; market_b: string; discrepancy_pct: number }>;
      markets_analyzed: Array<{ market_id: string; price_usdc: number }>;
    };

    assertEqual(parsed.markets_analyzed.length, 2, "should have 2 markets analyzed");
    assertEqual(parsed.opportunities.length, 1, "should have exactly 1 opportunity");

    const opp = parsed.opportunities[0];
    const expectedDiscrepancy = ((67567.5676 - 65000) / 65000) * 100;
    assert(
      Math.abs(opp.discrepancy_pct - expectedDiscrepancy) < 0.01,
      `discrepancy_pct should be ≈${expectedDiscrepancy.toFixed(2)}%, got ${opp.discrepancy_pct}`,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("threshold filtering excludes opportunities below threshold", async () => {
  const savedFetch = globalThis.fetch;

  // ~3.95% discrepancy between CLP and PEN — threshold 5% should exclude it
  const mockTickers = {
    tickers: [
      { market_id: "BTC-CLP", last_price: ["65000000", "CLP"], max_bid: ["64900000", "CLP"], min_ask: ["65100000", "CLP"], volume: ["4.99", "BTC"], price_variation_24h: "0.01", price_variation_7d: "0.05" },
      { market_id: "BTC-PEN", last_price: ["250000000", "PEN"], max_bid: ["249500000", "PEN"], min_ask: ["250500000", "PEN"], volume: ["1.5", "BTC"], price_variation_24h: "0.012", price_variation_7d: "0.04" },
      { market_id: "USDC-CLP", last_price: ["1000", "CLP"], max_bid: ["999", "CLP"], min_ask: ["1001", "CLP"], volume: ["100", "USDC"], price_variation_24h: "0.001", price_variation_7d: "0.002" },
      { market_id: "USDC-PEN", last_price: ["3700", "PEN"], max_bid: ["3695", "PEN"], min_ask: ["3705", "PEN"], volume: ["50", "USDC"], price_variation_24h: "0.001", price_variation_7d: "0.002" },
    ],
  };

  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockTickers), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleArbitrageOpportunities(
      { base_currency: "BTC", threshold_pct: 5.0 },
      client,
      cache,
    );

    assert(!result.isError, "should not return an error");
    const parsed = JSON.parse(result.content[0].text) as {
      opportunities: Array<unknown>;
    };
    assertEqual(parsed.opportunities.length, 0, "threshold 5% should exclude the ~3.95% discrepancy");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("returns error when fewer than 2 markets are found", async () => {
  const savedFetch = globalThis.fetch;

  // Only CLP market available, no PEN or COP
  const mockTickers = {
    tickers: [
      { market_id: "BTC-CLP", last_price: ["65000000", "CLP"], max_bid: ["64900000", "CLP"], min_ask: ["65100000", "CLP"], volume: ["4.99", "BTC"], price_variation_24h: "0.01", price_variation_7d: "0.05" },
      { market_id: "USDC-CLP", last_price: ["1000", "CLP"], max_bid: ["999", "CLP"], min_ask: ["1001", "CLP"], volume: ["100", "USDC"], price_variation_24h: "0.001", price_variation_7d: "0.002" },
    ],
  };

  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockTickers), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleArbitrageOpportunities(
      { base_currency: "BTC", threshold_pct: 0.5 },
      client,
      cache,
    );
    assert(result.isError === true, "should return isError when not enough markets");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// h. get_market_summary — liquidity_rating thresholds
// ----------------------------------------------------------------

section("h. get_market_summary — liquidity_rating thresholds");

await test("getLiquidityRating: spread < 0.3% → 'high'", () => {
  assertEqual(getLiquidityRating(0), "high", "0% spread should be high");
  assertEqual(getLiquidityRating(0.1), "high", "0.1% spread should be high");
  assertEqual(getLiquidityRating(0.29), "high", "0.29% spread should be high");
});

await test("getLiquidityRating: spread at 0.3% boundary → 'medium'", () => {
  assertEqual(getLiquidityRating(0.3), "medium", "exactly 0.3% spread should be medium");
});

await test("getLiquidityRating: spread 0.3–1% → 'medium'", () => {
  assertEqual(getLiquidityRating(0.5), "medium", "0.5% spread should be medium");
  assertEqual(getLiquidityRating(1.0), "medium", "exactly 1.0% spread should be medium");
});

await test("getLiquidityRating: spread > 1% → 'low'", () => {
  assertEqual(getLiquidityRating(1.01), "low", "1.01% spread should be low");
  assertEqual(getLiquidityRating(5.0), "low", "5% spread should be low");
});

await test("handleMarketSummary returns correct liquidity_rating from mocked API", async () => {
  const savedFetch = globalThis.fetch;
  let callCount = 0;

  // Ticker: bid 64870, ask 65000 → spread = 130 / 65000 * 100 = 0.2% → "high"
  const mockTicker = {
    ticker: {
      market_id: "BTC-CLP",
      last_price: ["65000", "CLP"],
      max_bid: ["64870", "CLP"],
      min_ask: ["65000", "CLP"],
      volume: ["4.99", "BTC"],
      price_variation_24h: "0.012",
      price_variation_7d: "0.05",
    },
  };
  const mockVolume = {
    volume: {
      market_id: "BTC-CLP",
      ask_volume_24h: ["10.5", "BTC"],
      ask_volume_7d: ["72.1", "BTC"],
      bid_volume_24h: ["9.8", "BTC"],
      bid_volume_7d: ["68.3", "BTC"],
    },
  };

  globalThis.fetch = async (url: string | URL): Promise<Response> => {
    callCount++;
    const urlStr = url.toString();
    if (urlStr.includes("/volume")) {
      return new Response(JSON.stringify(mockVolume), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(mockTicker), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleMarketSummary({ market_id: "BTC-CLP" }, client, cache);

    assert(!result.isError, "should not return an error");
    const parsed = JSON.parse(result.content[0].text) as {
      market_id: string;
      last_price: number;
      last_price_currency: string;
      bid: number;
      ask: number;
      spread_pct: number;
      volume_24h: number;
      liquidity_rating: string;
    };

    assertEqual(parsed.market_id, "BTC-CLP", "market_id should match");
    assertEqual(parsed.last_price, 65000, "last_price should be a number");
    assert(typeof parsed.last_price === "number", "last_price should be a number type");
    assertEqual(parsed.last_price_currency, "CLP", "currency should be CLP");
    assertEqual(parsed.bid, 64870, "bid should be a float");
    assertEqual(parsed.ask, 65000, "ask should be a float");
    // spread = (65000 - 64870) / 65000 * 100 = 130/65000*100 = 0.2%
    assertEqual(parsed.liquidity_rating, "high", "spread 0.2% should yield 'high' liquidity");
    assertEqual(parsed.volume_24h, 10.5, "volume_24h should be a float");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------

section("Summary");
if (failed === 0) {
  console.log(`  All ${passed} unit tests passed.`);
} else {
  console.error(`  ${failed} test(s) failed, ${passed} passed.`);
  process.exit(1);
}
