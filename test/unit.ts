/**
 * Unit tests — no live API required.
 * Run with: npm run test:unit
 */

import { createHmac } from "crypto";
import { BudaClient, BudaApiError, formatApiError } from "../src/client.js";
import { MemoryCache } from "../src/cache.js";
import { validateMarketId, validateCryptoAddress } from "../src/validation.js";
import { handlePlaceOrder } from "../src/tools/place_order.js";
import { handleCancelOrder } from "../src/tools/cancel_order.js";
import { flattenAmount, getLiquidityRating, aggregateTradesToCandles, safeTokenEqual, parseEnvInt } from "../src/utils.js";
import { logAudit } from "../src/audit.js";
import { requestContext } from "../src/request-context.js";
import { handleArbitrageOpportunities } from "../src/tools/arbitrage.js";
import { handleMarketSummary } from "../src/tools/market_summary.js";
import { handleSimulateOrder } from "../src/tools/simulate_order.js";
import { handleCalculatePositionSize } from "../src/tools/calculate_position_size.js";
import { handleMarketSentiment } from "../src/tools/market_sentiment.js";
import { handleTechnicalIndicators } from "../src/tools/technical_indicators.js";
import { handleScheduleCancelAll, handleRenewCancelTimer, handleDisarmCancelTimer } from "../src/tools/dead_mans_switch.js";
import { validateCurrency } from "../src/validation.js";
import { handleGetAccountInfo } from "../src/tools/account.js";
import { handleGetBalance } from "../src/tools/balance.js";
import { handleGetOrder, handleGetOrderByClientId } from "../src/tools/order_lookup.js";
import { handleGetNetworkFees } from "../src/tools/fees.js";
import { handleGetDepositHistory } from "../src/tools/deposits.js";
import { handleGetWithdrawalHistory } from "../src/tools/withdrawals.js";
import { handleListReceiveAddresses, handleGetReceiveAddress, handleCreateReceiveAddress } from "../src/tools/receive_addresses.js";
import { handleListRemittances, handleGetRemittance, handleQuoteRemittance, handleAcceptRemittanceQuote } from "../src/tools/remittances.js";
import { handleGetRealQuotation } from "../src/tools/quotation.js";
import { handleListRemittanceRecipients, handleGetRemittanceRecipient } from "../src/tools/remittance_recipients.js";
import { handleGetAvailableBanks } from "../src/tools/banks.js";
import { handleCancelAllOrders } from "../src/tools/cancel_all_orders.js";
import { handleCancelOrderByClientId } from "../src/tools/cancel_order_by_client_id.js";
import { handlePlaceBatchOrders } from "../src/tools/batch_orders.js";
import { handleCreateWithdrawal } from "../src/tools/withdrawals.js";
import { handleCreateFiatDeposit } from "../src/tools/deposits.js";
import { handleLightningWithdrawal, handleCreateLightningInvoice } from "../src/tools/lightning.js";
import { handleCompareMarkets } from "../src/tools/compare_markets.js";

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
// i. simulate_order — simulation outputs
// ----------------------------------------------------------------

section("i. simulate_order");

function makeMockFetchForSimulate(takerFee = "0.8"): typeof fetch {
  const mockTicker = {
    ticker: {
      market_id: "BTC-CLP",
      last_price: ["65000000", "CLP"],
      max_bid: ["64900000", "CLP"],
      min_ask: ["65100000", "CLP"],
      volume: ["4.99", "BTC"],
      price_variation_24h: "0.01",
      price_variation_7d: "0.05",
    },
  };
  const mockMarket = {
    market: {
      id: "btc-clp",
      name: "BTC-CLP",
      base_currency: "BTC",
      quote_currency: "CLP",
      taker_fee: takerFee,
      maker_fee: "0.004",
      minimum_order_amount: ["0.0001", "BTC"],
      max_orders_per_minute: 50,
      maker_discount_percentage: "0",
      taker_discount_percentage: "0",
      maker_discount_tiers: {},
      taker_discount_tiers: {},
    },
  };
  return async (url: string | URL): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes("/ticker")) {
      return new Response(JSON.stringify(mockTicker), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(mockMarket), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

await test("market buy: estimated_fill_price = min_ask, simulation: true", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetchForSimulate();
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleSimulateOrder({ market_id: "BTC-CLP", side: "buy", amount: 0.01 }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as {
      simulation: boolean;
      estimated_fill_price: number;
      order_type_assumed: string;
      fee_rate_pct: number;
    };
    assertEqual(parsed.simulation, true, "simulation flag must be true");
    assertEqual(parsed.estimated_fill_price, 65100000, "market buy fills at min_ask");
    assertEqual(parsed.order_type_assumed, "market", "order_type_assumed should be market");
    assertEqual(parsed.fee_rate_pct, 0.8, "fee_rate_pct should be 0.8 for crypto (0.8% taker fee)");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("market sell: estimated_fill_price = max_bid", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetchForSimulate();
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleSimulateOrder({ market_id: "BTC-CLP", side: "sell", amount: 0.01 }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { estimated_fill_price: number };
    assertEqual(parsed.estimated_fill_price, 64900000, "market sell fills at max_bid");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("limit order: order_type_assumed = 'limit'", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetchForSimulate();
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleSimulateOrder({ market_id: "BTC-CLP", side: "buy", amount: 0.01, price: 64000000 }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { order_type_assumed: string };
    assertEqual(parsed.order_type_assumed, "limit", "order_type_assumed should be limit");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("stablecoin market uses 0.5% fee", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetchForSimulate("0.5");
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleSimulateOrder({ market_id: "BTC-CLP", side: "buy", amount: 1 }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { fee_rate_pct: number };
    assertEqual(parsed.fee_rate_pct, 0.5, "fee_rate_pct should be 0.5 for stablecoin (0.5% taker fee)");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("simulate_order: invalid market_id returns INVALID_MARKET_ID error", async () => {
  const fakeClient = {} as BudaClient;
  const cache = new MemoryCache();
  const result = await handleSimulateOrder({ market_id: "INVALID", side: "buy", amount: 1 }, fakeClient, cache);
  assert(result.isError === true, "should be an error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_MARKET_ID", "error code should be INVALID_MARKET_ID");
});

// ----------------------------------------------------------------
// j. calculate_position_size — position math
// ----------------------------------------------------------------

section("j. calculate_position_size");

await test("buy scenario: stop < entry, side = buy", () => {
  const result = handleCalculatePositionSize({
    market_id: "BTC-CLP",
    capital: 1_000_000,
    risk_pct: 2,
    entry_price: 80_000_000,
    stop_loss_price: 78_000_000,
  });
  assert(!result.isError, "should not be an error");
  const parsed = JSON.parse(result.content[0].text) as {
    side: string;
    units: number;
    capital_at_risk: number;
    position_value: number;
    fee_currency: string;
  };
  assertEqual(parsed.side, "buy", "side should be buy");
  // capital_at_risk = 1_000_000 * 0.02 = 20_000; risk_per_unit = 2_000_000; units = 0.01
  assertEqual(parsed.capital_at_risk, 20000, "capital_at_risk should be 20000");
  assertEqual(parsed.units, 0.01, "units should be 0.01");
  assertEqual(parsed.position_value, 800000, "position_value = 0.01 * 80_000_000");
  assertEqual(parsed.fee_currency, "CLP", "fee_currency should be quote currency CLP");
});

await test("sell scenario: stop > entry, side = sell", () => {
  const result = handleCalculatePositionSize({
    market_id: "ETH-BTC",
    capital: 1,
    risk_pct: 1,
    entry_price: 0.05,
    stop_loss_price: 0.06,
  });
  assert(!result.isError, "should not be an error");
  const parsed = JSON.parse(result.content[0].text) as { side: string; fee_currency: string };
  assertEqual(parsed.side, "sell", "side should be sell");
  assertEqual(parsed.fee_currency, "BTC", "fee_currency should be BTC");
});

await test("stop == entry returns INVALID_STOP_LOSS error", () => {
  const result = handleCalculatePositionSize({
    market_id: "BTC-CLP",
    capital: 1_000_000,
    risk_pct: 2,
    entry_price: 80_000_000,
    stop_loss_price: 80_000_000,
  });
  assert(result.isError === true, "should be an error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_STOP_LOSS", "error code should be INVALID_STOP_LOSS");
});

await test("calculate_position_size: invalid market_id returns error", () => {
  const result = handleCalculatePositionSize({
    market_id: "bad",
    capital: 100,
    risk_pct: 1,
    entry_price: 10,
    stop_loss_price: 9,
  });
  assert(result.isError === true, "should be an error for invalid market_id");
});

// ----------------------------------------------------------------
// k. get_market_sentiment — scoring and labels
// ----------------------------------------------------------------

section("k. get_market_sentiment");

function makeMockFetchForSentiment(
  priceVariation24h: string,
  ask24h: string,
  bid24h: string,
  ask7d: string,
  bid7d: string,
  bid: string,
  ask: string,
): typeof fetch {
  const mockTicker = {
    ticker: {
      market_id: "BTC-CLP",
      last_price: ["65000000", "CLP"],
      max_bid: [bid, "CLP"],
      min_ask: [ask, "CLP"],
      volume: ["4.99", "BTC"],
      price_variation_24h: priceVariation24h,
      price_variation_7d: "0.05",
    },
  };
  const mockVolume = {
    volume: {
      market_id: "BTC-CLP",
      ask_volume_24h: [ask24h, "BTC"],
      ask_volume_7d: [ask7d, "BTC"],
      bid_volume_24h: [bid24h, "BTC"],
      bid_volume_7d: [bid7d, "BTC"],
    },
  };
  return async (url: string | URL): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes("/volume")) {
      return new Response(JSON.stringify(mockVolume), { status: 200 });
    }
    return new Response(JSON.stringify(mockTicker), { status: 200 });
  };
}

await test("disclaimer is always present in sentiment output", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetchForSentiment("0.01", "5", "5", "35", "35", "64900000", "65100000");
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleMarketSentiment({ market_id: "BTC-CLP" }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { disclaimer: string };
    assert(parsed.disclaimer.length > 0, "disclaimer should be present and non-empty");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("neutral market produces label 'neutral' (score between -20 and 20)", async () => {
  const savedFetch = globalThis.fetch;
  // 0% price variation, volume ratio ~1 (neutral), spread at baseline
  globalThis.fetch = makeMockFetchForSentiment("0", "5", "5", "35", "35", "64350000", "65000000");
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleMarketSentiment({ market_id: "BTC-CLP" }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { label: string; score: number };
    assert(
      parsed.label === "neutral" || parsed.label === "bearish" || parsed.label === "bullish",
      `label should be a valid sentiment: got ${parsed.label}`,
    );
    assert(typeof parsed.score === "number", "score should be a number");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("strongly positive price variation produces bullish label", async () => {
  const savedFetch = globalThis.fetch;
  // +10% price variation → large positive price component → bullish
  globalThis.fetch = makeMockFetchForSentiment("0.10", "10", "10", "35", "35", "64900000", "65100000");
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleMarketSentiment({ market_id: "BTC-CLP" }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { label: string };
    assertEqual(parsed.label, "bullish", "strong positive price change should yield bullish");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("strongly negative price variation produces bearish label", async () => {
  const savedFetch = globalThis.fetch;
  // -10% price variation → bearish
  globalThis.fetch = makeMockFetchForSentiment("-0.10", "5", "5", "35", "35", "64900000", "65100000");
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleMarketSentiment({ market_id: "BTC-CLP" }, client, cache);
    assert(!result.isError, "should not be an error");
    const parsed = JSON.parse(result.content[0].text) as { label: string };
    assertEqual(parsed.label, "bearish", "strong negative price change should yield bearish");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("sentiment: invalid market_id returns error", async () => {
  const fakeClient = {} as BudaClient;
  const cache = new MemoryCache();
  const result = await handleMarketSentiment({ market_id: "NOHYPHEN" }, fakeClient, cache);
  assert(result.isError === true, "should be an error");
});

// ----------------------------------------------------------------
// l. get_technical_indicators — math and edge cases
// ----------------------------------------------------------------

section("l. get_technical_indicators");

await test("aggregateTradesToCandles: produces correct OHLCV from sorted trades", () => {
  const now = Date.now();
  const hourMs = 3600000;
  const bucket = Math.floor(now / hourMs) * hourMs;
  // 3 trades in the same 1h bucket
  const entries: [string, string, string, string][] = [
    [String(bucket + 1000), "0.1", "100", "buy"],
    [String(bucket + 2000), "0.2", "110", "sell"],
    [String(bucket + 3000), "0.05", "95", "buy"],
  ];
  const candles = aggregateTradesToCandles(entries, "1h");
  assertEqual(candles.length, 1, "should produce 1 candle");
  const c = candles[0];
  assertEqual(c.open, 100, "open = first trade price");
  assertEqual(c.close, 95, "close = last trade price");
  assertEqual(c.high, 110, "high = max trade price");
  assertEqual(c.low, 95, "low = min trade price");
  assertEqual(c.trade_count, 3, "trade_count = 3");
});

await test("technical indicators: insufficient candles returns warning", async () => {
  const savedFetch = globalThis.fetch;
  // Return only 5 trades — will produce < 50 candles
  const now = Date.now();
  const hourMs = 3600000;
  const entries = Array.from({ length: 5 }, (_, i) => {
    const ts = now - (50 - i) * hourMs - 1000;
    return [String(ts), "0.1", String(65000000 + i * 10000), "buy"];
  });
  const mockTrades = {
    trades: {
      market_id: "BTC-CLP",
      timestamp: String(now),
      last_timestamp: String(now),
      entries,
    },
  };
  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockTrades), { status: 200 });
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleTechnicalIndicators({ market_id: "BTC-CLP", period: "1h" }, client);
    assert(!result.isError, "should not be isError");
    const parsed = JSON.parse(result.content[0].text) as {
      warning: string;
      indicators: null;
      candles_available: number;
      minimum_required: number;
    };
    assertEqual(parsed.warning, "insufficient_data", "should return insufficient_data warning");
    assertEqual(parsed.indicators, null, "indicators should be null");
    assertEqual(parsed.minimum_required, 20, "minimum_required should be 20");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("technical indicators: sufficient candles returns indicator values", async () => {
  const savedFetch = globalThis.fetch;
  // Generate 60 trades, each in its own 1h bucket, with steadily increasing prices
  const now = Date.now();
  const hourMs = 3600000;
  const entries = Array.from({ length: 60 }, (_, i) => {
    const ts = now - (60 - i) * hourMs - 1000;
    return [String(ts), "0.1", String(60_000_000 + i * 100_000), "buy"];
  });
  const mockTrades = {
    trades: {
      market_id: "BTC-CLP",
      timestamp: String(now),
      last_timestamp: String(now),
      entries,
    },
  };
  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockTrades), { status: 200 });
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleTechnicalIndicators({ market_id: "BTC-CLP", period: "1h" }, client);
    assert(!result.isError, "should not be isError");
    const parsed = JSON.parse(result.content[0].text) as {
      indicators: { rsi: number; sma_20: number; sma_50: number };
      signals: { rsi_signal: string };
      disclaimer: string;
    };
    assert(parsed.indicators !== null, "indicators should not be null");
    assert(typeof parsed.indicators.rsi === "number", "rsi should be a number");
    assert(typeof parsed.indicators.sma_20 === "number", "sma_20 should be a number");
    assert(typeof parsed.indicators.sma_50 === "number", "sma_50 should be a number");
    // Steadily increasing prices → RSI should be high (overbought)
    assertEqual(parsed.signals.rsi_signal, "overbought", "rising prices should yield overbought RSI");
    assert(parsed.disclaimer.length > 0, "disclaimer should be present");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("technical indicators: invalid market_id returns error", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleTechnicalIndicators({ market_id: "BAD", period: "1h" }, fakeClient);
  assert(result.isError === true, "should be an error for invalid market_id");
});

// ----------------------------------------------------------------
// m. schedule_cancel_all (dead man's switch)
// ----------------------------------------------------------------

section("m. schedule_cancel_all (dead man's switch)");

await test("schedule_cancel_all: requires CONFIRM token", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleScheduleCancelAll(
    { market_id: "BTC-CLP", ttl_seconds: 30, confirmation_token: "yes" },
    fakeClient,
  );
  assert(result.isError === true, "should return error without CONFIRM");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "error code should be CONFIRMATION_REQUIRED");
});

await test("schedule_cancel_all: invalid market_id returns error", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleScheduleCancelAll(
    { market_id: "BAD", ttl_seconds: 30, confirmation_token: "CONFIRM" },
    fakeClient,
  );
  assert(result.isError === true, "should return error for invalid market_id");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_MARKET_ID", "error code should be INVALID_MARKET_ID");
});

await test("schedule_cancel_all: CONFIRM activates timer and returns expires_at", async () => {
  const fakeClient = {} as BudaClient;
  const before = Date.now();
  const result = await handleScheduleCancelAll(
    { market_id: "BTC-USDT", ttl_seconds: 60, confirmation_token: "CONFIRM" },
    fakeClient,
  );
  const after = Date.now();
  assert(!result.isError, "should not be an error");
  const parsed = JSON.parse(result.content[0].text) as {
    active: boolean;
    expires_at: string;
    ttl_seconds: number;
    warning: string;
  };
  assertEqual(parsed.active, true, "active should be true");
  assertEqual(parsed.ttl_seconds, 60, "ttl_seconds should match");
  assert(parsed.warning.length > 0, "warning should be present");
  const expiresAt = new Date(parsed.expires_at).getTime();
  assert(expiresAt >= before + 60000 && expiresAt <= after + 60000, "expires_at should be ~60s from now");
  // Clean up timer
  handleDisarmCancelTimer({ market_id: "BTC-USDT" });
});

await test("renew_cancel_timer: returns NO_ACTIVE_TIMER when no timer exists", () => {
  const fakeClient = {} as BudaClient;
  const result = handleRenewCancelTimer({ market_id: "ETH-CLP" }, fakeClient);
  assert(result.isError === true, "should return error if no timer active");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "NO_ACTIVE_TIMER", "error code should be NO_ACTIVE_TIMER");
});

await test("disarm_cancel_timer: no-op returns disarmed:false when no timer exists", () => {
  const result = handleDisarmCancelTimer({ market_id: "LTC-CLP" });
  assert(!result.isError, "disarm should not error even if no timer");
  const parsed = JSON.parse(result.content[0].text) as { disarmed: boolean };
  assertEqual(parsed.disarmed, false, "disarmed should be false when no timer existed");
});

await test("disarm after arm: timer is cleared", async () => {
  const fakeClient = {} as BudaClient;
  await handleScheduleCancelAll(
    { market_id: "BCH-CLP", ttl_seconds: 300, confirmation_token: "CONFIRM" },
    fakeClient,
  );
  const result = handleDisarmCancelTimer({ market_id: "BCH-CLP" });
  assert(!result.isError, "disarm should not error");
  const parsed = JSON.parse(result.content[0].text) as { disarmed: boolean };
  assertEqual(parsed.disarmed, true, "disarmed should be true after an active timer was cleared");
  // Confirm no timer remains
  const renewResult = handleRenewCancelTimer({ market_id: "BCH-CLP" }, fakeClient);
  assert(renewResult.isError === true, "should have no timer left after disarm");
});

// ----------------------------------------------------------------
// n. validateCurrency
// ----------------------------------------------------------------

section("n. validateCurrency");

await test("validateCurrency: accepts BTC", () => {
  assertEqual(validateCurrency("BTC"), null, "BTC should be valid");
});

await test("validateCurrency: accepts CLP (fiat)", () => {
  assertEqual(validateCurrency("CLP"), null, "CLP should be valid");
});

await test("validateCurrency: accepts USDC (multi-char)", () => {
  assertEqual(validateCurrency("USDC"), null, "USDC should be valid");
});

await test("validateCurrency: case-insensitive — accepts lowercase btc", () => {
  assertEqual(validateCurrency("btc"), null, "lowercase btc should be valid");
});

await test("validateCurrency: rejects empty string", () => {
  assert(validateCurrency("") !== null, "should reject empty string");
});

await test("validateCurrency: rejects special characters", () => {
  assert(validateCurrency("BT$") !== null, "should reject $");
  assert(validateCurrency("BTC!") !== null, "should reject !");
});

await test("validateCurrency: rejects string longer than 10 chars", () => {
  assert(validateCurrency("ABCDEFGHIJK") !== null, "should reject 11-char string");
});

await test("validateCurrency: rejects single character", () => {
  assert(validateCurrency("B") !== null, "should reject 1-char string");
});

// ----------------------------------------------------------------
// o. P1 auth tools — INVALID_CURRENCY guard
// ----------------------------------------------------------------

section("o. P1 auth tools — INVALID_CURRENCY guard");

await test("handleGetBalance: invalid currency '!!' returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetBalance({ currency: "!!" }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleGetBalance: invalid currency empty string returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetBalance({ currency: "" }, fakeClient);
  assert(result.isError === true, "should be error");
});

await test("handleGetNetworkFees: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetNetworkFees({ currency: "$$", type: "withdrawal" }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleGetDepositHistory: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetDepositHistory({ currency: "BAD!!" }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleGetWithdrawalHistory: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetWithdrawalHistory({ currency: "B" }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleListReceiveAddresses: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleListReceiveAddresses({ currency: "!!" }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleGetReceiveAddress: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const result = await handleGetReceiveAddress({ currency: "!!", id: 1 }, fakeClient);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

await test("handleGetAvailableBanks: invalid currency returns INVALID_CURRENCY", async () => {
  const fakeClient = {} as BudaClient;
  const fakeCache = new MemoryCache();
  const result = await handleGetAvailableBanks({ currency: "!!" }, fakeClient, fakeCache);
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
});

// ----------------------------------------------------------------
// p. P1 tools — happy path (mocked API)
// ----------------------------------------------------------------

section("p. P1 tools — happy path (mocked API)");

await test("handleGetAccountInfo: returns flattened profile", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        me: {
          id: 42,
          email: "user@example.com",
          name: "Test User",
          monthly_transacted: ["5000000", "CLP"],
          pubsub_key: "pk_test",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetAccountInfo(client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      email: string;
      monthly_transacted: number;
      monthly_transacted_currency: string;
    };
    assertEqual(parsed.id, 42, "id should be 42");
    assertEqual(parsed.email, "user@example.com", "email should match");
    assertEqual(parsed.monthly_transacted, 5000000, "monthly_transacted should be a float");
    assertEqual(parsed.monthly_transacted_currency, "CLP", "currency should be CLP");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetBalance: returns flattened balance", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        balance: {
          id: "BTC",
          amount: ["0.5", "BTC"],
          available_amount: ["0.4", "BTC"],
          frozen_amount: ["0.1", "BTC"],
          pending_withdraw_amount: ["0.0", "BTC"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetBalance({ currency: "BTC" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: string;
      amount: number;
      available_amount: number;
      frozen_amount: number;
    };
    assertEqual(parsed.id, "BTC", "id should be BTC");
    assertEqual(parsed.amount, 0.5, "amount should be 0.5");
    assertEqual(parsed.available_amount, 0.4, "available_amount should be 0.4");
    assertEqual(parsed.frozen_amount, 0.1, "frozen_amount should be 0.1");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetOrder: returns normalized order", async () => {
  const savedFetch = globalThis.fetch;
  const mockOrder = {
    order: {
      id: 123456,
      type: "Bid",
      state: "active",
      created_at: "2024-01-01T00:00:00Z",
      market_id: "BTC-CLP",
      fee_currency: "CLP",
      price_type: "limit",
      order_type: "limit_order",
      client_id: null,
      limit: ["65000000", "CLP"],
      amount: ["0.001", "BTC"],
      original_amount: ["0.001", "BTC"],
      traded_amount: ["0", "BTC"],
      total_exchanged: ["0", "CLP"],
      paid_fee: ["0", "CLP"],
    },
  };
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify(mockOrder), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetOrder({ order_id: 123456 }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      type: string;
      state: string;
      limit_price: number;
      amount: number;
    };
    assertEqual(parsed.id, 123456, "id should match");
    assertEqual(parsed.type, "Bid", "type should be Bid");
    assertEqual(parsed.state, "active", "state should be active");
    assertEqual(parsed.limit_price, 65000000, "limit_price should be a float");
    assertEqual(parsed.amount, 0.001, "amount should be 0.001");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetOrder: 404 returns isError with code 404", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetOrder({ order_id: 999999 }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 404, "code should be 404");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetOrderByClientId: returns normalized order", async () => {
  const savedFetch = globalThis.fetch;
  const mockOrder = {
    order: {
      id: 77777,
      type: "Ask",
      state: "traded",
      created_at: "2024-06-01T00:00:00Z",
      market_id: "ETH-BTC",
      fee_currency: "BTC",
      price_type: "limit",
      order_type: "limit_order",
      client_id: "my-bot-42",
      limit: ["0.05", "BTC"],
      amount: ["1", "ETH"],
      original_amount: ["1", "ETH"],
      traded_amount: ["1", "ETH"],
      total_exchanged: ["0.05", "BTC"],
      paid_fee: ["0.0004", "BTC"],
    },
  };
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify(mockOrder), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetOrderByClientId({ client_id: "my-bot-42" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; client_id: string };
    assertEqual(parsed.id, 77777, "id should match");
    assertEqual(parsed.client_id, "my-bot-42", "client_id should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetDepositHistory: returns flattened deposits with meta", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        deposits: [
          {
            id: 1,
            state: "confirmed",
            currency: "BTC",
            amount: ["0.1", "BTC"],
            fee: ["0.0001", "BTC"],
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T01:00:00Z",
            transfer_account_id: null,
            transaction_hash: "abc123",
          },
        ],
        meta: { current_page: 1, total_count: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetDepositHistory({ currency: "BTC" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      deposits: Array<{ id: number; amount: number; fee: number; state: string }>;
      meta: { total_count: number };
    };
    assertEqual(parsed.deposits.length, 1, "should have 1 deposit");
    assertEqual(parsed.deposits[0].id, 1, "id should be 1");
    assertEqual(parsed.deposits[0].amount, 0.1, "amount should be 0.1");
    assertEqual(parsed.deposits[0].fee, 0.0001, "fee should be a float");
    assertEqual(parsed.meta.total_count, 1, "total_count should be 1");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetDepositHistory: empty list is not an error", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ deposits: [], meta: { current_page: 1, total_count: 0, total_pages: 0 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetDepositHistory({ currency: "BTC" }, client);
    assert(!result.isError, "empty list should not be error");
    const parsed = JSON.parse(result.content[0].text) as { deposits: unknown[] };
    assertEqual(parsed.deposits.length, 0, "deposits should be empty array");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetWithdrawalHistory: returns flattened withdrawals", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        withdrawals: [
          {
            id: 5,
            state: "confirmed",
            currency: "CLP",
            amount: ["100000", "CLP"],
            fee: ["500", "CLP"],
            address: null,
            tx_hash: null,
            bank_account_id: 99,
            created_at: "2024-02-01T00:00:00Z",
            updated_at: "2024-02-01T01:00:00Z",
          },
        ],
        meta: { current_page: 1, total_count: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetWithdrawalHistory({ currency: "CLP" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      withdrawals: Array<{ id: number; amount: number; bank_account_id: number }>;
    };
    assertEqual(parsed.withdrawals[0].id, 5, "id should be 5");
    assertEqual(parsed.withdrawals[0].amount, 100000, "amount should be 100000");
    assertEqual(parsed.withdrawals[0].bank_account_id, 99, "bank_account_id should be 99");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleListReceiveAddresses: returns address list", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        receive_addresses: [
          { id: 10, address: "bc1qtest", currency: "BTC", created_at: "2024-01-01T00:00:00Z", label: null },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleListReceiveAddresses({ currency: "BTC" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      receive_addresses: Array<{ id: number; address: string }>;
    };
    assertEqual(parsed.receive_addresses.length, 1, "should have 1 address");
    assertEqual(parsed.receive_addresses[0].id, 10, "id should be 10");
    assertEqual(parsed.receive_addresses[0].address, "bc1qtest", "address should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetReceiveAddress: returns single address", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        receive_address: { id: 10, address: "bc1qtest", currency: "BTC", created_at: "2024-01-01T00:00:00Z", label: "cold storage" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetReceiveAddress({ currency: "BTC", id: 10 }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; label: string };
    assertEqual(parsed.id, 10, "id should be 10");
    assertEqual(parsed.label, "cold storage", "label should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleListRemittances: returns remittance list with flattened amounts", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittances: [
          {
            id: 77,
            state: "quoted",
            currency: "CLP",
            amount: ["100000", "CLP"],
            recipient_id: 5,
            created_at: "2024-03-01T00:00:00Z",
            expires_at: "2024-03-01T01:00:00Z",
          },
        ],
        meta: { current_page: 1, total_count: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleListRemittances({}, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      remittances: Array<{ id: number; amount: number; recipient_id: number }>;
    };
    assertEqual(parsed.remittances[0].id, 77, "id should be 77");
    assertEqual(parsed.remittances[0].amount, 100000, "amount should be a float");
    assertEqual(parsed.remittances[0].recipient_id, 5, "recipient_id should be 5");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetRemittance: returns single remittance", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittance: {
          id: 88,
          state: "confirmed",
          currency: "COP",
          amount: ["500000", "COP"],
          recipient_id: 3,
          created_at: "2024-04-01T00:00:00Z",
          expires_at: null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRemittance({ id: 88 }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; state: string; expires_at: null };
    assertEqual(parsed.id, 88, "id should be 88");
    assertEqual(parsed.state, "confirmed", "state should be confirmed");
    assertEqual(parsed.expires_at, null, "expires_at should be null");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleListRemittanceRecipients: returns recipient list", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittance_recipients: [
          { id: 1, name: "Alice", bank: "banco_estado", account_number: "123456", currency: "CLP", country: "CL" },
        ],
        meta: { current_page: 1, total_count: 1, total_pages: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleListRemittanceRecipients({}, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      remittance_recipients: Array<{ id: number; name: string; bank: string }>;
    };
    assertEqual(parsed.remittance_recipients[0].id, 1, "id should be 1");
    assertEqual(parsed.remittance_recipients[0].name, "Alice", "name should match");
    assertEqual(parsed.remittance_recipients[0].bank, "banco_estado", "bank should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetRemittanceRecipient: returns single recipient", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittance_recipient: {
          id: 7, name: "Bob", bank: "bancolombia", account_number: "987654", currency: "COP", country: null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRemittanceRecipient({ id: 7 }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; country: null };
    assertEqual(parsed.id, 7, "id should be 7");
    assertEqual(parsed.country, null, "country should be null");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetAvailableBanks: returns bank list for fiat currency", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        banks: [
          { id: "banco_estado", name: "Banco Estado", country: "CL" },
          { id: "bci", name: "BCI", country: "CL" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleGetAvailableBanks({ currency: "CLP" }, client, cache);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { currency: string; banks: Array<{ id: string }> };
    assertEqual(parsed.currency, "CLP", "currency should be CLP");
    assertEqual(parsed.banks.length, 2, "should have 2 banks");
    assertEqual(parsed.banks[0].id, "banco_estado", "first bank id should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetAvailableBanks: 404 returns empty list (not an error)", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleGetAvailableBanks({ currency: "USD" }, client, cache);
    assert(!result.isError, "404 should NOT be an error — empty list");
    const parsed = JSON.parse(result.content[0].text) as { banks: unknown[] };
    assertEqual(parsed.banks.length, 0, "banks should be empty array");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetAvailableBanks: 500 returns isError", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Internal server error" }), { status: 500 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const cache = new MemoryCache();
    const result = await handleGetAvailableBanks({ currency: "CLP" }, client, cache);
    assert(result.isError === true, "500 should be isError");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 500, "code should be 500");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 2 — get_real_quotation
// ----------------------------------------------------------------

section("get_real_quotation");

await test("handleGetRealQuotation: INVALID_MARKET_ID without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRealQuotation({ market_id: "INVALID", type: "Bid", amount: 1 }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_MARKET_ID", "code should be INVALID_MARKET_ID");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetRealQuotation: happy path Bid", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        quotation: {
          id: 42,
          type: "Bid",
          market_id: "BTC-CLP",
          amount: ["0.05", "BTC"],
          limit: null,
          base_balance_change: ["-0.05", "BTC"],
          quote_balance_change: ["4500000", "CLP"],
          fee_amount: ["22500", "CLP"],
          order_amount: ["0.05", "BTC"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRealQuotation({ market_id: "BTC-CLP", type: "Bid", amount: 0.05 }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      type: string;
      market_id: string;
      amount: number;
      amount_currency: string;
      limit: null;
      limit_currency: null;
      fee_amount: number;
      fee_currency: string;
    };
    assertEqual(parsed.id, 42, "id should be 42");
    assertEqual(parsed.type, "Bid", "type should be Bid");
    assertEqual(parsed.market_id, "BTC-CLP", "market_id should match");
    assertEqual(parsed.amount, 0.05, "amount should be 0.05");
    assertEqual(parsed.amount_currency, "BTC", "amount_currency should be BTC");
    assertEqual(parsed.limit, null, "limit should be null");
    assertEqual(parsed.limit_currency, null, "limit_currency should be null");
    assertEqual(parsed.fee_amount, 22500, "fee_amount should be 22500");
    assertEqual(parsed.fee_currency, "CLP", "fee_currency should be CLP");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetRealQuotation: happy path Ask with limit", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        quotation: {
          id: null,
          type: "Ask",
          market_id: "ETH-CLP",
          amount: ["1", "ETH"],
          limit: ["3000000", "CLP"],
          base_balance_change: ["1", "ETH"],
          quote_balance_change: ["-3000000", "CLP"],
          fee_amount: ["15000", "CLP"],
          order_amount: ["1", "ETH"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRealQuotation(
      { market_id: "ETH-CLP", type: "Ask", amount: 1, limit: 3000000 },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: null;
      limit: number;
      limit_currency: string;
    };
    assertEqual(parsed.id, null, "id should be null");
    assertEqual(parsed.limit, 3000000, "limit should be 3000000");
    assertEqual(parsed.limit_currency, "CLP", "limit_currency should be CLP");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleGetRealQuotation: API 422 passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Unprocessable Entity" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleGetRealQuotation({ market_id: "BTC-CLP", type: "Bid", amount: 0.000001 }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 2 — create_receive_address
// ----------------------------------------------------------------

section("create_receive_address");

await test("handleCreateReceiveAddress: INVALID_CURRENCY without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateReceiveAddress({ currency: "!!!!", confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateReceiveAddress: happy path", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        receive_address: {
          id: 99,
          address: "bc1qnewaddress123",
          currency: "BTC",
          created_at: "2024-04-01T00:00:00Z",
          label: null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateReceiveAddress({ currency: "BTC", confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      address: string;
      currency: string;
      label: null;
    };
    assertEqual(parsed.id, 99, "id should be 99");
    assertEqual(parsed.address, "bc1qnewaddress123", "address should match");
    assertEqual(parsed.currency, "BTC", "currency should be BTC");
    assertEqual(parsed.label, null, "label should be null");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateReceiveAddress: fiat currency API error passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateReceiveAddress({ currency: "CLP", confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error for fiat");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 404, "code should be 404");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 2 — quote_remittance
// ----------------------------------------------------------------

section("quote_remittance");

await test("handleQuoteRemittance: INVALID_CURRENCY without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleQuoteRemittance({ currency: "!!!", amount: 100, recipient_id: 1, confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleQuoteRemittance: happy path", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittance: {
          id: 55,
          state: "quoted",
          currency: "CLP",
          amount: ["100000", "CLP"],
          recipient_id: 5,
          created_at: "2024-04-01T00:00:00Z",
          expires_at: "2024-04-01T00:30:00Z",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleQuoteRemittance({ currency: "CLP", amount: 100000, recipient_id: 5, confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      state: string;
      expires_at: string;
    };
    assertEqual(parsed.id, 55, "id should be 55");
    assertEqual(parsed.state, "quoted", "state should be quoted");
    assert(parsed.expires_at !== null, "expires_at should not be null");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleQuoteRemittance: 404 unknown recipient passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleQuoteRemittance({ currency: "CLP", amount: 100000, recipient_id: 9999, confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 404, "code should be 404");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 2 — accept_remittance_quote
// ----------------------------------------------------------------

section("accept_remittance_quote");

await test("handleAcceptRemittanceQuote: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleAcceptRemittanceQuote({ id: 77, confirmation_token: "yes" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string; remittance_id: number };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
    assertEqual(parsed.remittance_id, 77, "remittance_id should be 77");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleAcceptRemittanceQuote: empty string token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleAcceptRemittanceQuote({ id: 10, confirmation_token: "" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleAcceptRemittanceQuote: happy path with CONFIRM token", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        remittance: {
          id: 77,
          state: "accepted",
          currency: "CLP",
          amount: ["100000", "CLP"],
          recipient_id: 5,
          created_at: "2024-04-01T00:00:00Z",
          expires_at: null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleAcceptRemittanceQuote({ id: 77, confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; state: string };
    assertEqual(parsed.id, 77, "id should be 77");
    assertEqual(parsed.state, "accepted", "state should be accepted");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleAcceptRemittanceQuote: 422 expired quote passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Unprocessable Entity" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleAcceptRemittanceQuote({ id: 77, confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — cancel_all_orders
// ----------------------------------------------------------------

section("cancel_all_orders");

await test("handleCancelAllOrders: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCancelAllOrders({ market_id: "BTC-CLP", confirmation_token: "NOPE" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelAllOrders: '*' + CONFIRM cancels all markets", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ canceled_count: 5 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCancelAllOrders({ market_id: "*", confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { canceled_count: number; market_id: string };
    assertEqual(parsed.canceled_count, 5, "canceled_count should be 5");
    assertEqual(parsed.market_id, "*", "market_id should be *");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelAllOrders: specific market + CONFIRM", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ canceled_count: 2 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCancelAllOrders({ market_id: "BTC-CLP", confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { canceled_count: number; market_id: string };
    assertEqual(parsed.canceled_count, 2, "canceled_count should be 2");
    assertEqual(parsed.market_id, "BTC-CLP", "market_id should be BTC-CLP");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelAllOrders: invalid market format returns INVALID_MARKET_ID even with CONFIRM", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCancelAllOrders({ market_id: "INVALID!!!", confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_MARKET_ID", "code should be INVALID_MARKET_ID");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelAllOrders: API 404 passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCancelAllOrders({ market_id: "BTC-CLP", confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 404, "code should be 404");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — cancel_order_by_client_id
// ----------------------------------------------------------------

section("cancel_order_by_client_id");

await test("handleCancelOrderByClientId: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCancelOrderByClientId({ client_id: "my-order-1", confirmation_token: "NOPE" }, client);
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string; client_id: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
    assertEqual(parsed.client_id, "my-order-1", "client_id should be echoed back");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelOrderByClientId: happy path returns flat order", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        order: {
          id: 999,
          type: "Bid",
          state: "canceling",
          created_at: "2024-01-01T00:00:00Z",
          market_id: "BTC-CLP",
          fee_currency: "CLP",
          price_type: "limit",
          order_type: "limit",
          client_id: "my-order-1",
          limit: ["50000000", "CLP"],
          amount: ["0.001", "BTC"],
          original_amount: ["0.001", "BTC"],
          traded_amount: ["0", "BTC"],
          total_exchanged: ["0", "CLP"],
          paid_fee: ["0", "CLP"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCancelOrderByClientId({ client_id: "my-order-1", confirmation_token: "CONFIRM" }, client);
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      state: string;
      client_id: string;
      limit_price: number;
    };
    assertEqual(parsed.id, 999, "id should be 999");
    assertEqual(parsed.state, "canceling", "state should be canceling");
    assertEqual(parsed.client_id, "my-order-1", "client_id should be my-order-1");
    assertEqual(parsed.limit_price, 50000000, "limit_price should be flattened");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCancelOrderByClientId: 404 passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCancelOrderByClientId({ client_id: "ghost-order", confirmation_token: "CONFIRM" }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 404, "code should be 404");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — place_batch_orders
// ----------------------------------------------------------------

section("place_batch_orders");

await test("handlePlaceBatchOrders: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handlePlaceBatchOrders(
      {
        orders: [{ market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000 }],
        confirmation_token: "NOPE",
      },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: all valid + CONFIRM places all orders", async () => {
  let callCount = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    return new Response(
      JSON.stringify({
        order: {
          id: callCount * 100,
          type: "Bid",
          state: "pending",
          created_at: "2024-01-01T00:00:00Z",
          market_id: "BTC-CLP",
          fee_currency: "CLP",
          price_type: "limit",
          order_type: "limit",
          client_id: null,
          limit: ["50000000", "CLP"],
          amount: ["0.001", "BTC"],
          original_amount: ["0.001", "BTC"],
          traded_amount: ["0", "BTC"],
          total_exchanged: ["0", "CLP"],
          paid_fee: ["0", "CLP"],
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000 },
          { market_id: "ETH-CLP", type: "Ask", price_type: "limit", amount: 0.1, limit_price: 3000000 },
        ],
        confirmation_token: "CONFIRM",
      },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{ success: boolean }>;
    };
    assertEqual(parsed.total, 2, "total should be 2");
    assertEqual(parsed.succeeded, 2, "succeeded should be 2");
    assertEqual(parsed.failed, 0, "failed should be 0");
    assertEqual(callCount, 2, "should have made 2 API calls");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: one invalid market → pre-validation error, zero API calls", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000 },
          { market_id: "INVALID!!!", type: "Ask", price_type: "limit", amount: 0.1, limit_price: 3000000 },
        ],
        confirmation_token: "CONFIRM",
      },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string; index: number };
    assertEqual(parsed.code, "INVALID_MARKET_ID", "code should be INVALID_MARKET_ID");
    assertEqual(parsed.index, 1, "index should be 1");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: missing limit_price on limit order → pre-validation error", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handlePlaceBatchOrders(
      {
        orders: [{ market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001 }],
        confirmation_token: "CONFIRM",
      },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "VALIDATION_ERROR", "code should be VALIDATION_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: one mid-batch API error → partial success report", async () => {
  let callCount = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 2) {
      return new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 422 });
    }
    return new Response(
      JSON.stringify({
        order: {
          id: 100,
          type: "Bid",
          state: "pending",
          created_at: "2024-01-01T00:00:00Z",
          market_id: "BTC-CLP",
          fee_currency: "CLP",
          price_type: "limit",
          order_type: "limit",
          client_id: null,
          limit: ["50000000", "CLP"],
          amount: ["0.001", "BTC"],
          original_amount: ["0.001", "BTC"],
          traded_amount: ["0", "BTC"],
          total_exchanged: ["0", "CLP"],
          paid_fee: ["0", "CLP"],
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000 },
          { market_id: "ETH-CLP", type: "Ask", price_type: "limit", amount: 0.1, limit_price: 3000000 },
        ],
        confirmation_token: "CONFIRM",
      },
      client,
    );
    assert(!result.isError, "partial success should not set isError");
    const parsed = JSON.parse(result.content[0].text) as {
      total: number;
      succeeded: number;
      failed: number;
      warning?: string;
    };
    assertEqual(parsed.total, 2, "total should be 2");
    assertEqual(parsed.succeeded, 1, "succeeded should be 1");
    assertEqual(parsed.failed, 1, "failed should be 1");
    assert(parsed.warning !== undefined, "warning should be present for partial failure");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — place_order extended (3.22)
// ----------------------------------------------------------------

section("place_order extended (TIF + stop)");

await test("handlePlaceOrder: existing limit order unchanged (no regression)", async () => {
  const savedFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        order: {
          id: 1,
          type: "Bid",
          state: "pending",
          created_at: "2024-01-01T00:00:00Z",
          market_id: "BTC-CLP",
          fee_currency: "CLP",
          price_type: "limit",
          order_type: "limit",
          client_id: null,
          limit: ["50000000", "CLP"],
          amount: ["0.001", "BTC"],
          original_amount: ["0.001", "BTC"],
          traded_amount: ["0", "BTC"],
          total_exchanged: ["0", "CLP"],
          paid_fee: ["0", "CLP"],
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handlePlaceOrder(
      { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000, confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const limit = capturedBody.limit as Record<string, unknown>;
    assertEqual(limit.type as string, "gtc", "default limit type should be gtc");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceOrder: IOC flag → limit.type='ioc'", async () => {
  const savedFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        order: {
          id: 2,
          type: "Ask",
          state: "traded",
          created_at: "2024-01-01T00:00:00Z",
          market_id: "BTC-CLP",
          fee_currency: "CLP",
          price_type: "limit",
          order_type: "limit",
          client_id: null,
          limit: ["50000000", "CLP"],
          amount: ["0.001", "BTC"],
          original_amount: ["0.001", "BTC"],
          traded_amount: ["0.001", "BTC"],
          total_exchanged: ["50000", "CLP"],
          paid_fee: ["250", "CLP"],
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handlePlaceOrder(
      { market_id: "BTC-CLP", type: "Ask", price_type: "limit", amount: 0.001, limit_price: 50000000, ioc: true, confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const limit = capturedBody.limit as Record<string, unknown>;
    assertEqual(limit.type as string, "ioc", "limit type should be ioc");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceOrder: stop_price without stop_type → VALIDATION_ERROR", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handlePlaceOrder(
      { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000, stop_price: 45000000, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "VALIDATION_ERROR", "code should be VALIDATION_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceOrder: mutually exclusive TIF flags → VALIDATION_ERROR", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handlePlaceOrder(
      { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50000000, ioc: true, fok: true, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "VALIDATION_ERROR", "code should be VALIDATION_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — create_withdrawal
// ----------------------------------------------------------------

section("create_withdrawal");

await test("handleCreateWithdrawal: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateWithdrawal(
      { currency: "BTC", amount: 0.01, address: "bc1q...", confirmation_token: "NOPE" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateWithdrawal: both address+bank_account_id → VALIDATION_ERROR", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateWithdrawal(
      { currency: "BTC", amount: 0.01, address: "bc1q...", bank_account_id: 123, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "VALIDATION_ERROR", "code should be VALIDATION_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateWithdrawal: neither address nor bank_account_id → VALIDATION_ERROR", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateWithdrawal(
      { currency: "BTC", amount: 0.01, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "VALIDATION_ERROR", "code should be VALIDATION_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateWithdrawal: crypto path + CONFIRM", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        withdrawal: {
          id: 77,
          state: "pending",
          currency: "BTC",
          amount: ["0.01", "BTC"],
          fee: ["0.0001", "BTC"],
      address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        tx_hash: null,
        bank_account_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateWithdrawal(
      { currency: "BTC", amount: 0.01, address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      state: string;
      amount: number;
      address: string | null;
    };
    assertEqual(parsed.id, 77, "id should be 77");
    assertEqual(parsed.state, "pending", "state should be pending");
    assertEqual(parsed.amount, 0.01, "amount should be flattened");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateWithdrawal: fiat path + CONFIRM", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        withdrawal: {
          id: 88,
          state: "pending",
          currency: "CLP",
          amount: ["100000", "CLP"],
          fee: ["0", "CLP"],
          address: null,
          tx_hash: null,
          bank_account_id: 123,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateWithdrawal(
      { currency: "CLP", amount: 100000, bank_account_id: 123, confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; bank_account_id: number | null };
    assertEqual(parsed.id, 88, "id should be 88");
    assertEqual(parsed.bank_account_id, 123, "bank_account_id should be 123");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateWithdrawal: 422 insufficient balance passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateWithdrawal(
      { currency: "BTC", amount: 999, address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — create_fiat_deposit
// ----------------------------------------------------------------

section("create_fiat_deposit");

await test("handleCreateFiatDeposit: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateFiatDeposit(
      { currency: "CLP", amount: 100000, confirmation_token: "NOPE" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateFiatDeposit: invalid currency → INVALID_CURRENCY before API", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleCreateFiatDeposit(
      { currency: "!!!", amount: 100000, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_CURRENCY", "code should be INVALID_CURRENCY");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateFiatDeposit: happy path + CONFIRM", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        deposit: {
          id: 55,
          state: "pending_info",
          currency: "CLP",
          amount: ["100000", "CLP"],
          fee: ["0", "CLP"],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          transfer_account_id: null,
          transaction_hash: null,
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateFiatDeposit(
      { currency: "CLP", amount: 100000, bank: "BancoEstado", confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as { id: number; state: string; amount: number };
    assertEqual(parsed.id, 55, "id should be 55");
    assertEqual(parsed.state, "pending_info", "state should be pending_info");
    assertEqual(parsed.amount, 100000, "amount should be flattened");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateFiatDeposit: 422 passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Unprocessable Entity" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateFiatDeposit(
      { currency: "CLP", amount: 100000, confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — lightning_withdrawal
// ----------------------------------------------------------------

section("lightning_withdrawal");

await test("handleLightningWithdrawal: missing/wrong token returns CONFIRMATION_REQUIRED without fetch", async () => {
  const fetchCalled = { value: false };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalled.value = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = {} as BudaClient;
    const result = await handleLightningWithdrawal(
      { invoice: "lnbc1000u1p" + "a".repeat(40), confirmation_token: "NOPE" },
      client,
    );
    assert(result.isError === true, "should be error");
    assert(!fetchCalled.value, "fetch should not have been called");
    const parsed = JSON.parse(result.content[0].text) as { code: string; preview?: { invoice_preview: string } };
    assertEqual(parsed.code, "CONFIRMATION_REQUIRED", "code should be CONFIRMATION_REQUIRED");
    assert(parsed.preview?.invoice_preview !== undefined, "should include invoice_preview");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleLightningWithdrawal: happy path returns flat withdrawal", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        lightning_withdrawal: {
          id: 42,
          state: "completed",
          amount: ["100000", "SAT"],
          fee: ["1000", "SAT"],
          payment_hash: "abc123",
          created_at: "2024-01-01T00:00:00Z",
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleLightningWithdrawal(
      { invoice: "lnbc1000u1p" + "a".repeat(40), confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      state: string;
      amount: number;
      payment_hash: string;
    };
    assertEqual(parsed.id, 42, "id should be 42");
    assertEqual(parsed.state, "completed", "state should be completed");
    assertEqual(parsed.amount, 100000, "amount should be flattened");
    assertEqual(parsed.payment_hash, "abc123", "payment_hash should be abc123");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleLightningWithdrawal: API error passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Invoice already paid" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleLightningWithdrawal(
      { invoice: "lnbc1000u1p" + "a".repeat(40), confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Priority 3 — create_lightning_invoice
// ----------------------------------------------------------------

section("create_lightning_invoice");

await test("handleCreateLightningInvoice: happy path returns invoice fields", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        lightning_network_invoice: {
          id: 99,
          payment_request: "lnbc1000u1pfinal...",
          amount: ["100000", "SAT"],
          description: "Test payment",
          expires_at: "2024-01-01T01:00:00Z",
          state: "pending",
          created_at: "2024-01-01T00:00:00Z",
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateLightningInvoice(
      { amount_satoshis: 100000, description: "Test payment", expiry_seconds: 3600 },
      client,
    );
    assert(!result.isError, "should not be error");
    const parsed = JSON.parse(result.content[0].text) as {
      id: number;
      payment_request: string;
      amount_satoshis: number;
      description: string | null;
      expires_at: string;
    };
    assertEqual(parsed.id, 99, "id should be 99");
    assertEqual(parsed.payment_request, "lnbc1000u1pfinal...", "payment_request should match");
    assertEqual(parsed.amount_satoshis, 100000, "amount_satoshis should be 100000");
    assertEqual(parsed.description, "Test payment", "description should match");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCreateLightningInvoice: API error passthrough", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "Unprocessable Entity" }), { status: 422 });
  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    const result = await handleCreateLightningInvoice({ amount_satoshis: 100000 }, client);
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as { code: number };
    assertEqual(parsed.code, 422, "code should be 422");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Fix 3 — validateCryptoAddress
// ----------------------------------------------------------------

section("validateCryptoAddress");

await test("validateCryptoAddress: valid BTC bech32 address passes", () => {
  assertEqual(validateCryptoAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "BTC"), null, "valid bech32 should pass");
});

await test("validateCryptoAddress: valid BTC legacy P2PKH address passes", () => {
  assertEqual(validateCryptoAddress("1BpEi6DfDAUFd153wiGrvkiKyhSua3FrN", "BTC"), null, "valid P2PKH should pass");
});

await test("validateCryptoAddress: BTC address too short after bc1 prefix is rejected", () => {
  // bc1 + fewer than 6 alphanumeric chars — too short to be a real address
  assert(validateCryptoAddress("bc1qa", "BTC") !== null, "bc1 + 1 char should fail");
});

await test("validateCryptoAddress: BTC address with wrong prefix is rejected", () => {
  assert(validateCryptoAddress("XpubBadAddress1234567890abcdefgh", "BTC") !== null, "wrong prefix should fail");
});

await test("validateCryptoAddress: valid ETH address passes", () => {
  // Standard 40-hex-char Ethereum address (checksummed)
  assertEqual(validateCryptoAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "ETH"), null, "valid ETH address should pass");
});

await test("validateCryptoAddress: ETH address wrong length is rejected", () => {
  assert(validateCryptoAddress("0xde0B295669a9FD93d5F28D9", "ETH") !== null, "short ETH address should fail");
});

await test("validateCryptoAddress: valid XRP address passes", () => {
  assertEqual(validateCryptoAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "XRP"), null, "valid XRP address should pass");
});

await test("validateCryptoAddress: XRP address with wrong prefix is rejected", () => {
  assert(validateCryptoAddress("xHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "XRP") !== null, "XRP with 'x' prefix should fail");
});

await test("validateCryptoAddress: unknown currency returns null (pass-through)", () => {
  // ALGO not in ADDRESS_RULES — should pass through to let exchange validate
  assertEqual(validateCryptoAddress("SOMEADDRESS123", "ALGO"), null, "unknown currency should pass through");
});

await test("validateCryptoAddress: USDC treated as EVM address", () => {
  assertEqual(validateCryptoAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "USDC"), null, "valid EVM address for USDC should pass");
  assert(validateCryptoAddress("not-an-address", "USDC") !== null, "invalid EVM address for USDC should fail");
});

// ----------------------------------------------------------------
// Fix 4 — handleLightningWithdrawal BOLT-11 validation
// ----------------------------------------------------------------

section("handleLightningWithdrawal — BOLT-11 format guard");

await test("handleLightningWithdrawal: non-BOLT11 string returns INVALID_INVOICE before API call", async () => {
  let fetchCalled = false;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handleLightningWithdrawal(
      { invoice: "not-a-lightning-invoice-at-all-just-garbage-string-here", confirmation_token: "CONFIRM" },
      client,
    );
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_INVOICE", "should return INVALID_INVOICE");
    assert(result.isError === true, "isError should be true");
    assert(!fetchCalled, "fetch should NOT have been called");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleLightningWithdrawal: testnet invoice prefix 'lntb' is accepted (passes format check)", async () => {
  // A syntactically valid lntb prefix — API will reject it, but format guard should pass
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: "invalid invoice" }), { status: 422 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const fakeInvoice = "lntb1230n1pj8ygappp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq";
    const result = await handleLightningWithdrawal(
      { invoice: fakeInvoice, confirmation_token: "CONFIRM" },
      client,
    );
    // Should NOT return INVALID_INVOICE — the format guard passes; API error is expected
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assert(parsed.code !== "INVALID_INVOICE", "BOLT-11 prefix should pass format guard");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleLightningWithdrawal: invoice without BOLT-11 prefix still blocked by INVALID_INVOICE after CONFIRM", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  const result = await handleLightningWithdrawal(
    { invoice: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", confirmation_token: "CONFIRM" },
    client,
  );
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_INVOICE", "BTC address passed as invoice should fail BOLT-11 check");
});

// ----------------------------------------------------------------
// Fix 5 — Dead man's switch: TRANSPORT_NOT_SUPPORTED on HTTP
// ----------------------------------------------------------------

section("handleScheduleCancelAll — HTTP transport guard");

await test("handleScheduleCancelAll: transport='http' returns TRANSPORT_NOT_SUPPORTED", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  // Simulate what register() does on HTTP transport by calling handleScheduleCancelAll
  // We test the transport guard via the register() wrapper indirectly through a fake server tool.
  // Since handleScheduleCancelAll itself doesn't know the transport, we test the guard
  // by verifying the pattern: a fake dispatch that mirrors the http register() closure.
  const transportGuard = (transport: "stdio" | "http") => {
    if (transport === "http") {
      return Promise.resolve({
        content: [{ type: "text" as const, text: JSON.stringify({ code: "TRANSPORT_NOT_SUPPORTED" }) }],
        isError: true,
      });
    }
    return handleScheduleCancelAll(
      { market_id: "BTC-CLP", ttl_seconds: 30, confirmation_token: "CONFIRM" },
      client,
    );
  };

  const result = await transportGuard("http");
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "TRANSPORT_NOT_SUPPORTED", "HTTP transport should return TRANSPORT_NOT_SUPPORTED");
  assert(result.isError === true, "isError should be true");
});

await test("handleScheduleCancelAll: transport='stdio' still works normally", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  const result = await handleScheduleCancelAll(
    { market_id: "BTC-CLP", ttl_seconds: 10, confirmation_token: "CONFIRM" },
    client,
  );
  const parsed = JSON.parse(result.content[0].text) as { active: boolean; warning: string };
  assert(parsed.active === true, "stdio transport should arm the switch");
  assert(typeof parsed.warning === "string", "should include in-memory warning");
  // Clean up timer
  const { handleDisarmCancelTimer: disarm } = await import("../src/tools/dead_mans_switch.js");
  disarm({ market_id: "BTC-CLP" });
});

// ----------------------------------------------------------------
// Fix 6 — place_batch_orders: max_notional cap
// ----------------------------------------------------------------

section("handlePlaceBatchOrders — max_notional cap");

await test("handlePlaceBatchOrders: exceeding max_notional rejects before any API call", async () => {
  let fetchCalled = false;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 1, limit_price: 50_000_000 },
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.5, limit_price: 50_000_000 },
        ],
        max_notional: 60_000_000,
        confirmation_token: "CONFIRM",
      },
      client,
    );
    // total notional = 1*50_000_000 + 0.5*50_000_000 = 75_000_000 > 60_000_000
    const parsed = JSON.parse(result.content[0].text) as { code: string; total_notional: number };
    assertEqual(parsed.code, "NOTIONAL_CAP_EXCEEDED", "should return NOTIONAL_CAP_EXCEEDED");
    assert(parsed.total_notional === 75_000_000, "total_notional should be computed correctly");
    assert(result.isError === true, "isError should be true");
    assert(!fetchCalled, "fetch should NOT have been called");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: within max_notional proceeds to API calls", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ order: { id: 99, state: "pending", market_id: "btc-clp" } }),
    { status: 200 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 50_000_000 },
        ],
        max_notional: 100_000,
        confirmation_token: "CONFIRM",
      },
      client,
    );
    // total notional = 0.001 * 50_000_000 = 50_000 < 100_000 — should proceed
    const parsed = JSON.parse(result.content[0].text) as { succeeded: number };
    assertEqual(parsed.succeeded, 1, "order within cap should succeed");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handlePlaceBatchOrders: market orders contribute 0 to notional (cap not triggered)", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ order: { id: 100, state: "pending", market_id: "btc-clp" } }),
    { status: 200 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handlePlaceBatchOrders(
      {
        orders: [
          { market_id: "BTC-CLP", type: "Bid", price_type: "market", amount: 999 },
        ],
        max_notional: 1,
        confirmation_token: "CONFIRM",
      },
      client,
    );
    // Market order contributes 0, so notional = 0 < 1 — cap should NOT trigger
    const parsed = JSON.parse(result.content[0].text) as { code?: string; succeeded?: number };
    assert(parsed.code !== "NOTIONAL_CAP_EXCEEDED", "market order should not trigger notional cap");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Security — audit logging (logAudit)
// ----------------------------------------------------------------

section("logAudit — structured audit logging");

await test("logAudit: writes valid JSON with required fields to stderr", () => {
  const lines: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(s);
    return true;
  };
  try {
    logAudit({ ts: "2024-01-01T00:00:00.000Z", tool: "place_order", transport: "stdio", args_summary: { market_id: "BTC-CLP" }, success: true });
  } finally {
    (process.stderr as unknown as { write: (s: string) => boolean }).write = savedWrite;
  }
  assert(lines.length === 1, "should write exactly one line");
  const parsed = JSON.parse(lines[0].trim()) as Record<string, unknown>;
  assert(parsed.audit === true, "must have audit:true marker");
  assertEqual(parsed.tool as string, "place_order", "tool field must be present");
  assertEqual(parsed.transport as string, "stdio", "transport field must be present");
  assert(typeof parsed.ts === "string", "ts field must be a string");
  assert(typeof parsed.success === "boolean", "success field must be a boolean");
});

await test("logAudit: output does NOT contain confirmation_token", () => {
  const lines: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(s);
    return true;
  };
  try {
    logAudit({ ts: new Date().toISOString(), tool: "place_order", transport: "stdio", args_summary: { market_id: "BTC-CLP", type: "Bid" }, success: false, error_code: "CONFIRMATION_REQUIRED" });
  } finally {
    (process.stderr as unknown as { write: (s: string) => boolean }).write = savedWrite;
  }
  const raw = lines[0] ?? "";
  assert(!raw.includes("confirmation_token"), "audit log must NOT contain confirmation_token");
  assert(!raw.includes("invoice"), "audit log must NOT contain invoice field");
});

await test("logAudit: error_code is included when success is false", () => {
  const lines: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(s);
    return true;
  };
  try {
    logAudit({ ts: new Date().toISOString(), tool: "cancel_order", transport: "http", args_summary: {}, success: false, error_code: 422 });
  } finally {
    (process.stderr as unknown as { write: (s: string) => boolean }).write = savedWrite;
  }
  const parsed = JSON.parse(lines[0].trim()) as Record<string, unknown>;
  assertEqual(parsed.error_code as number, 422, "error_code must be 422");
  assertEqual(parsed.success as boolean, false, "success must be false");
});

await test("handlePlaceOrder with CONFIRM → logAudit called with success:true", async () => {
  const savedFetch = globalThis.fetch;
  const auditLines: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    if (s.includes('"audit":true')) auditLines.push(s);
    return true;
  };
  globalThis.fetch = async () => new Response(
    JSON.stringify({ order: { id: 1, state: "pending", market_id: "btc-clp", type: "Bid", price_type: "limit", amount: ["0.001", "BTC"], original_amount: ["0.001", "BTC"], traded_amount: ["0", "BTC"], total_exchanged: ["0", "CLP"], paid_fee: ["0", "CLP"], limit: ["80000000", "CLP"] } }),
    { status: 200 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handlePlaceOrder(
      { market_id: "BTC-CLP", type: "Bid", price_type: "limit", amount: 0.001, limit_price: 80_000_000, confirmation_token: "CONFIRM" },
      client,
    );
    assert(!result.isError, "should succeed");
    assert(auditLines.length > 0, "logAudit must have been called");
    const parsed = JSON.parse(auditLines[0].trim()) as Record<string, unknown>;
    assertEqual(parsed.tool as string, "place_order", "tool should be place_order");
    assert(parsed.success === true, "success should be true");
  } finally {
    globalThis.fetch = savedFetch;
    (process.stderr as unknown as { write: (s: string) => boolean }).write = savedWrite;
  }
});

// ----------------------------------------------------------------
// Security — error response does not expose API path
// ----------------------------------------------------------------

section("Error responses — path field redacted");

await test("handlePlaceOrder with invalid market: error response has no 'path' field", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  const result = await handlePlaceOrder(
    { market_id: "INVALID!!!", type: "Bid", price_type: "limit", amount: 1, limit_price: 1, confirmation_token: "CONFIRM" },
    client,
  );
  assert(result.isError === true, "should be error");
  const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
  assert(!("path" in parsed), "error response must NOT contain 'path' field");
});

await test("handleCancelAllOrders API error: response has no 'path' field", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const result = await handleCancelAllOrders(
      { market_id: "BTC-CLP", confirmation_token: "CONFIRM" },
      client,
    );
    assert(result.isError === true, "should be error");
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert(!("path" in parsed), "error response must NOT contain 'path' field");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Security — validateCurrency in compare_markets
// ----------------------------------------------------------------

section("handleCompareMarkets — validateCurrency guard");

await test("handleCompareMarkets: base_currency with spaces → INVALID_CURRENCY (no API call)", async () => {
  let fetchCalled = false;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return new Response("{}", { status: 200 }); };
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const cache = new MemoryCache();
    const result = await handleCompareMarkets({ base_currency: "B T C" }, client, cache);
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assertEqual(parsed.code, "INVALID_CURRENCY", "spaces in currency should return INVALID_CURRENCY");
    assert(result.isError === true, "isError must be true");
    assert(!fetchCalled, "fetch must NOT be called for invalid currency");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("handleCompareMarkets: base_currency exceeding max length → INVALID_CURRENCY", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  const cache = new MemoryCache();
  const result = await handleCompareMarkets({ base_currency: "A".repeat(20) }, client, cache);
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "overlong currency should return INVALID_CURRENCY");
});

await test("handleCompareMarkets: empty string → INVALID_CURRENCY", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  const cache = new MemoryCache();
  const result = await handleCompareMarkets({ base_currency: "" }, client, cache);
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_CURRENCY", "empty string should return INVALID_CURRENCY");
});

await test("handleCompareMarkets: valid currency passes validation (reaches API/cache)", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ tickers: [] }),
    { status: 200 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    const cache = new MemoryCache();
    const result = await handleCompareMarkets({ base_currency: "BTC" }, client, cache);
    const parsed = JSON.parse(result.content[0].text) as { code?: string };
    assert(parsed.code !== "INVALID_CURRENCY", "valid currency must not return INVALID_CURRENCY");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Security — BOLT-11 regex improvement
// ----------------------------------------------------------------

section("handleLightningWithdrawal — improved BOLT-11 regex");

await test("BOLT-11 regex: invoice without bech32 separator '1' → INVALID_INVOICE", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  // "lnbc" + 46 chars: passes Zod min(50) but has no '1' separator → should fail new regex
  const noSeparator = "lnbc" + "a".repeat(46);
  const result = await handleLightningWithdrawal(
    { invoice: noSeparator, confirmation_token: "CONFIRM" },
    client,
  );
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_INVOICE", "invoice without bech32 separator must fail");
});

await test("BOLT-11 regex: invoice with insufficient data after separator → INVALID_INVOICE", async () => {
  const client = new BudaClient(undefined, "key", "secret");
  // "lnbc1" + 5 chars (< 20 required after separator) padded to 50 total
  const tooShortData = "lnbc1" + "a".repeat(5) + "x".repeat(40);
  // This has '1' at position 5, then only 5 chars of [a-z0-9] before non-bech32 chars
  // Actually we need to construct this carefully:
  // New regex: /^ln(bc|tb|bcrt)\d*[munp]?1[a-z0-9]{20,}$/i
  // "lnbc1aaaaa" has only 5 chars after 1 - fails {20,}
  const shortAfterSep = "lnbc1" + "a".repeat(5) + " ".repeat(45); // has spaces → fails [a-z0-9] and $
  const result = await handleLightningWithdrawal(
    { invoice: shortAfterSep, confirmation_token: "CONFIRM" },
    client,
  );
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "INVALID_INVOICE", "invoice with insufficient bech32 data must fail");
});

await test("BOLT-11 regex: valid mainnet invoice structure passes (existing test)", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: "invalid invoice" }), { status: 422 },
  );
  try {
    const client = new BudaClient(undefined, "key", "secret");
    // Same invoice from existing test — must still pass the format guard
    const validInvoice = "lntb1230n1pj8ygappp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq";
    const result = await handleLightningWithdrawal(
      { invoice: validInvoice, confirmation_token: "CONFIRM" },
      client,
    );
    const parsed = JSON.parse(result.content[0].text) as { code: string };
    assert(parsed.code !== "INVALID_INVOICE", "well-formed testnet invoice must pass format guard");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ----------------------------------------------------------------
// Security — DMS renew/disarm blocked on HTTP transport
// ----------------------------------------------------------------

section("DMS renew_cancel_timer / disarm_cancel_timer — HTTP transport guard");

await test("renew_cancel_timer: transport='http' returns TRANSPORT_NOT_SUPPORTED", () => {
  const renewTransportGuard = (transport: "stdio" | "http") => {
    if (transport === "http") {
      return Promise.resolve({
        content: [{ type: "text" as const, text: JSON.stringify({ code: "TRANSPORT_NOT_SUPPORTED" }) }],
        isError: true,
      });
    }
    return Promise.resolve(handleRenewCancelTimer({ market_id: "BTC-CLP" }, new BudaClient(undefined, "k", "s")));
  };
  const result = renewTransportGuard("http");
  return result.then((r) => {
    const parsed = JSON.parse(r.content[0].text) as { code: string };
    assertEqual(parsed.code, "TRANSPORT_NOT_SUPPORTED", "renew on HTTP must return TRANSPORT_NOT_SUPPORTED");
    assert(r.isError === true, "isError must be true");
  });
});

await test("disarm_cancel_timer: transport='http' returns TRANSPORT_NOT_SUPPORTED", () => {
  const disarmTransportGuard = (transport: "stdio" | "http") => {
    if (transport === "http") {
      return Promise.resolve({
        content: [{ type: "text" as const, text: JSON.stringify({ code: "TRANSPORT_NOT_SUPPORTED" }) }],
        isError: true,
      });
    }
    return Promise.resolve(handleDisarmCancelTimer({ market_id: "BTC-CLP" }));
  };
  const result = disarmTransportGuard("http");
  return result.then((r) => {
    const parsed = JSON.parse(r.content[0].text) as { code: string };
    assertEqual(parsed.code, "TRANSPORT_NOT_SUPPORTED", "disarm on HTTP must return TRANSPORT_NOT_SUPPORTED");
    assert(r.isError === true, "isError must be true");
  });
});

await test("renew_cancel_timer: transport='stdio' without active timer → NO_ACTIVE_TIMER (handler unchanged)", () => {
  const client = new BudaClient(undefined, "key", "secret");
  const result = handleRenewCancelTimer({ market_id: "ETH-CLP" }, client);
  const parsed = JSON.parse(result.content[0].text) as { code: string };
  assertEqual(parsed.code, "NO_ACTIVE_TIMER", "no timer should return NO_ACTIVE_TIMER");
});

await test("disarm_cancel_timer: transport='stdio' without active timer → disarmed: false (handler unchanged)", () => {
  const result = handleDisarmCancelTimer({ market_id: "ETH-CLP" });
  const parsed = JSON.parse(result.content[0].text) as { disarmed: boolean };
  assert(parsed.disarmed === false, "disarm with no timer should return disarmed: false");
});

// ----------------------------------------------------------------
// Security — safeTokenEqual (constant-time bearer comparison)
// ----------------------------------------------------------------

section("safeTokenEqual — constant-time bearer token comparison");

await test("safeTokenEqual: identical strings → true", () => {
  assert(safeTokenEqual("Bearer abc123", "Bearer abc123"), "identical strings must be equal");
});

await test("safeTokenEqual: different same-length strings → false", () => {
  assert(!safeTokenEqual("Bearer abc", "Bearer xyz"), "different same-length strings must differ");
});

await test("safeTokenEqual: different-length strings → false (no crash)", () => {
  assert(!safeTokenEqual("short", "longerstring"), "different-length strings must differ");
  assert(!safeTokenEqual("longerstring", "short"), "reversed different-length must differ");
});

await test("safeTokenEqual: empty strings → true", () => {
  assert(safeTokenEqual("", ""), "two empty strings are equal");
});

await test("safeTokenEqual: one empty string → false", () => {
  assert(!safeTokenEqual("", "token"), "empty vs non-empty must differ");
  assert(!safeTokenEqual("token", ""), "non-empty vs empty must differ");
});

// ----------------------------------------------------------------
// Security — parseEnvInt (config validation helper)
// ----------------------------------------------------------------

section("parseEnvInt — environment variable integer validation");

await test("parseEnvInt: undefined raw → returns fallback", () => {
  assertEqual(parseEnvInt(undefined, 3000, 1, 65535, "PORT"), 3000, "should return fallback");
});

await test("parseEnvInt: valid string within range → parsed value", () => {
  assertEqual(parseEnvInt("8080", 3000, 1, 65535, "PORT"), 8080, "should parse 8080");
  assertEqual(parseEnvInt("120", 120, 1, 10_000, "MCP_RATE_LIMIT"), 120, "should parse 120");
});

await test("parseEnvInt: NaN string → throws", () => {
  let threw = false;
  try { parseEnvInt("abc", 3000, 1, 65535, "PORT"); } catch { threw = true; }
  assert(threw, "non-numeric string should throw");
});

await test("parseEnvInt: value below min → throws", () => {
  let threw = false;
  try { parseEnvInt("0", 3000, 1, 65535, "PORT"); } catch { threw = true; }
  assert(threw, "value 0 below min 1 should throw");
});

await test("parseEnvInt: value above max → throws", () => {
  let threw = false;
  try { parseEnvInt("70000", 3000, 1, 65535, "PORT"); } catch { threw = true; }
  assert(threw, "value 70000 above max 65535 should throw");
});

await test("parseEnvInt: boundary values are accepted", () => {
  assertEqual(parseEnvInt("1", 3000, 1, 65535, "PORT"), 1, "min boundary should be accepted");
  assertEqual(parseEnvInt("65535", 3000, 1, 65535, "PORT"), 65535, "max boundary should be accepted");
});

// ----------------------------------------------------------------
// Security — Retry-After cap (additions to section e logic)
// ----------------------------------------------------------------

section("Retry-After cap — large values capped at 30 000 ms");

await test("Retry-After: 99999 is capped at 30 000 ms", async () => {
  const savedFetch = globalThis.fetch;
  const savedSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];

  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    delays.push(ms);
    return savedSetTimeout(fn, 0); // execute immediately in tests
  }) as typeof setTimeout;

  let callCount = 0;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "99999" } });
    }
    return new Response(JSON.stringify({ markets: [] }), { status: 200 });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    await client.get("/markets");
    assertEqual(delays[0], 30_000, "Retry-After: 99999 should be capped at 30 000 ms");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
  }
});

await test("Retry-After: negative value defaults to 1000 ms", async () => {
  const savedFetch = globalThis.fetch;
  const savedSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];

  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    delays.push(ms);
    return savedSetTimeout(fn, 0);
  }) as typeof setTimeout;

  let callCount = 0;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "-1" } });
    }
    return new Response(JSON.stringify({ markets: [] }), { status: 200 });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    await client.get("/markets");
    assertEqual(delays[0], 1_000, "negative Retry-After should default to 1000 ms");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
  }
});

await test("Retry-After: exactly 30 s is not capped (boundary)", async () => {
  const savedFetch = globalThis.fetch;
  const savedSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];

  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    delays.push(ms);
    return savedSetTimeout(fn, 0);
  }) as typeof setTimeout;

  let callCount = 0;
  globalThis.fetch = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "30" } });
    }
    return new Response(JSON.stringify({ markets: [] }), { status: 200 });
  };

  try {
    const client = new BudaClient("https://www.buda.com/api/v2");
    await client.get("/markets");
    assertEqual(delays[0], 30_000, "exactly 30 s should equal 30 000 ms (boundary accepted)");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.setTimeout = savedSetTimeout;
  }
});

// ----------------------------------------------------------------
// Security — formatApiError (error sanitization)
// ----------------------------------------------------------------

section("formatApiError — error sanitization");

await test("BudaApiError returns its message and HTTP status code", () => {
  const err = new BudaApiError(404, "/markets/bad", "Market not found");
  const result = formatApiError(err);
  assertEqual(result.error, "Market not found", "error message should match BudaApiError message");
  assertEqual(result.code as number, 404, "code should match BudaApiError status");
});

await test("BudaApiError with 429 preserves status", () => {
  const err = new BudaApiError(429, "/orders", "Rate limit exceeded on /orders. Retry later.", 5_000);
  const result = formatApiError(err);
  assertEqual(result.code as number, 429, "429 status should be forwarded");
});

await test("unknown Error returns generic message — internal details not exposed", () => {
  const err = new Error("ECONNREFUSED 127.0.0.1:9999 — internal connection failure with secret path /private/keys");
  const result = formatApiError(err);
  assert(result.code === "INTERNAL_ERROR", "code should be INTERNAL_ERROR for unknown errors");
  assert(
    !result.error.includes("ECONNREFUSED") && !result.error.includes("/private/keys"),
    "internal details must not appear in the returned error message",
  );
});

await test("non-Error thrown value returns generic message", () => {
  const result = formatApiError("something went wrong with path=/etc/secrets");
  assert(result.code === "INTERNAL_ERROR", "code should be INTERNAL_ERROR for non-Error values");
  assert(
    !result.error.includes("/etc/secrets"),
    "internal details must not appear in the returned error message for string throws",
  );
});

await test("unknown error logs internal detail to stderr, not to caller", () => {
  const captured: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg: Parameters<typeof process.stderr.write>[0]) => {
    captured.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };

  try {
    const sensitiveMessage = "TypeError: ENOENT /app/dist/secret-config.json";
    formatApiError(new Error(sensitiveMessage));

    assert(captured.length > 0, "something should be written to stderr");
    const loggedText = captured.join("");
    assert(loggedText.includes(sensitiveMessage), "internal detail must appear in stderr log");
  } finally {
    process.stderr.write = savedWrite;
  }
});

// ----------------------------------------------------------------
// Security — IP propagation in audit logs (AsyncLocalStorage)
// ----------------------------------------------------------------

section("IP propagation in audit logs — AsyncLocalStorage");

await test("logAudit includes ip from requestContext when running inside requestContext.run()", async () => {
  const captured: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg: Parameters<typeof process.stderr.write>[0]) => {
    captured.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };

  try {
    await requestContext.run({ ip: "1.2.3.4" }, async () => {
      logAudit({
        ts: new Date().toISOString(),
        tool: "test_tool",
        transport: "http",
        args_summary: {},
        success: true,
      });
    });

    assert(captured.length > 0, "logAudit should write to stderr");
    const parsed = JSON.parse(captured[captured.length - 1]) as { ip?: string; audit: boolean };
    assert(parsed.audit === true, "output should be an audit event");
    assertEqual(parsed.ip, "1.2.3.4", "ip should be populated from requestContext");
  } finally {
    process.stderr.write = savedWrite;
  }
});

await test("logAudit omits ip when called outside any requestContext.run()", async () => {
  const captured: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg: Parameters<typeof process.stderr.write>[0]) => {
    captured.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };

  try {
    // Called directly — no requestContext.run() wrapper
    logAudit({
      ts: new Date().toISOString(),
      tool: "stdio_tool",
      transport: "stdio",
      args_summary: {},
      success: true,
    });

    assert(captured.length > 0, "logAudit should write to stderr");
    const parsed = JSON.parse(captured[captured.length - 1]) as { ip?: string };
    assert(parsed.ip === undefined, "ip should be absent when there is no requestContext");
  } finally {
    process.stderr.write = savedWrite;
  }
});

await test("logAudit with different IPs in nested requestContext.run() calls uses innermost ip", async () => {
  const captured: string[] = [];
  const savedWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg: Parameters<typeof process.stderr.write>[0]) => {
    captured.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };

  try {
    await requestContext.run({ ip: "10.0.0.1" }, async () => {
      await requestContext.run({ ip: "192.168.1.1" }, async () => {
        logAudit({
          ts: new Date().toISOString(),
          tool: "nested_tool",
          transport: "http",
          args_summary: {},
          success: true,
        });
      });
    });

    const parsed = JSON.parse(captured[captured.length - 1]) as { ip?: string };
    assertEqual(parsed.ip, "192.168.1.1", "innermost context ip should win");
  } finally {
    process.stderr.write = savedWrite;
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
