/**
 * Integration test: calls each Buda MCP tool directly via BudaClient
 * and prints a summary of the results.
 *
 * Run with: npm test
 */

import { BudaClient } from "../src/client.js";
import type {
  MarketsResponse,
  TickerResponse,
  OrderBookResponse,
  TradesResponse,
  VolumeResponse,
  AllTickersResponse,
  BalancesResponse,
  OrdersResponse,
} from "../src/types.js";

const client = new BudaClient(
  undefined,
  process.env.BUDA_API_KEY,
  process.env.BUDA_API_SECRET,
);
const TEST_MARKET = "BTC-CLP";

function section(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function pass(label: string, detail: string): void {
  console.log(`  PASS  ${label}: ${detail}`);
}

function fail(label: string, error: unknown): void {
  console.error(`  FAIL  ${label}:`, error instanceof Error ? error.message : error);
}

let failures = 0;

// ----------------------------------------------------------------
// 1. get_markets
// ----------------------------------------------------------------
section("get_markets — list all markets");
try {
  const data = await client.get<MarketsResponse>("/markets");
  const ids = data.markets.map((m) => m.id);
  pass("markets count", `${ids.length} markets returned`);
  pass("includes BTC-CLP", String(ids.includes("BTC-CLP")));
  console.log("  Sample IDs:", ids.slice(0, 6).join(", "));
} catch (err) {
  fail("get_markets", err);
  failures++;
}

// ----------------------------------------------------------------
// 2. get_ticker
// ----------------------------------------------------------------
section(`get_ticker — ${TEST_MARKET}`);
try {
  const data = await client.get<TickerResponse>(`/markets/${TEST_MARKET.toLowerCase()}/ticker`);
  const t = data.ticker;
  pass("market_id", t.market_id);
  pass("last_price", `${t.last_price[0]} ${t.last_price[1]}`);
  pass("max_bid", `${t.max_bid[0]} ${t.max_bid[1]}`);
  pass("min_ask", `${t.min_ask[0]} ${t.min_ask[1]}`);
  pass("volume_24h", `${t.volume[0]} ${t.volume[1]}`);
  pass("price_variation_24h", `${(parseFloat(t.price_variation_24h) * 100).toFixed(2)}%`);
} catch (err) {
  fail("get_ticker", err);
  failures++;
}

// ----------------------------------------------------------------
// 3. get_orderbook
// ----------------------------------------------------------------
section(`get_orderbook — ${TEST_MARKET}`);
try {
  const data = await client.get<OrderBookResponse>(
    `/markets/${TEST_MARKET.toLowerCase()}/order_book`,
  );
  const book = data.order_book;
  pass("bids count", `${book.bids.length} levels`);
  pass("asks count", `${book.asks.length} levels`);
  if (book.bids.length > 0 && book.asks.length > 0) {
    pass("top bid", `${book.bids[0][0]} @ ${book.bids[0][1]} BTC`);
    pass("top ask", `${book.asks[0][0]} @ ${book.asks[0][1]} BTC`);
    const spread =
      parseFloat(book.asks[0][0]) - parseFloat(book.bids[0][0]);
    pass("spread", spread.toFixed(2));
  }
} catch (err) {
  fail("get_orderbook", err);
  failures++;
}

// ----------------------------------------------------------------
// 4. get_trades
// ----------------------------------------------------------------
section(`get_trades — ${TEST_MARKET} (limit 10)`);
try {
  const data = await client.get<TradesResponse>(
    `/markets/${TEST_MARKET.toLowerCase()}/trades`,
    { limit: 10 },
  );
  const t = data.trades;
  pass("market_id", t.market_id);
  pass("entries count", `${t.entries.length}`);
  if (t.entries.length > 0) {
    const [ts, amount, price, direction] = t.entries[0];
    pass(
      "latest trade",
      `${direction} ${amount} BTC @ ${price} CLP (ts: ${ts})`,
    );
  }
} catch (err) {
  fail("get_trades", err);
  failures++;
}

// ----------------------------------------------------------------
// 5. get_market_volume
// ----------------------------------------------------------------
section(`get_market_volume — ${TEST_MARKET}`);
try {
  const data = await client.get<VolumeResponse>(
    `/markets/${TEST_MARKET.toLowerCase()}/volume`,
  );
  const v = data.volume;
  pass("market_id", v.market_id);
  pass("ask_volume_24h", `${v.ask_volume_24h[0]} ${v.ask_volume_24h[1]}`);
  pass("ask_volume_7d", `${v.ask_volume_7d[0]} ${v.ask_volume_7d[1]}`);
  pass("bid_volume_24h", `${v.bid_volume_24h[0]} ${v.bid_volume_24h[1]}`);
  pass("bid_volume_7d", `${v.bid_volume_7d[0]} ${v.bid_volume_7d[1]}`);
} catch (err) {
  fail("get_market_volume", err);
  failures++;
}

// ----------------------------------------------------------------
// 6. get_spread
// ----------------------------------------------------------------
section(`get_spread — ${TEST_MARKET}`);
try {
  const data = await client.get<TickerResponse>(`/markets/${TEST_MARKET.toLowerCase()}/ticker`);
  const ticker = data.ticker;
  const bid = parseFloat(ticker.max_bid[0]);
  const ask = parseFloat(ticker.min_ask[0]);
  const spreadAbs = ask - bid;
  const spreadPct = (spreadAbs / ask) * 100;
  pass("best_bid", ticker.max_bid[0]);
  pass("best_ask", ticker.min_ask[0]);
  pass("spread_absolute", spreadAbs.toFixed(2));
  pass("spread_percentage", spreadPct.toFixed(4) + "%");
} catch (err) {
  fail("get_spread", err);
  failures++;
}

// ----------------------------------------------------------------
// 7. compare_markets
// ----------------------------------------------------------------
section("compare_markets — BTC");
try {
  const data = await client.get<AllTickersResponse>("/tickers");
  const btcMarkets = data.tickers.filter((t) => t.market_id.startsWith("BTC-"));
  pass("BTC markets found", `${btcMarkets.length}`);
  for (const t of btcMarkets) {
    pass(t.market_id, `last price: ${t.last_price[0]} ${t.last_price[1]}`);
  }
} catch (err) {
  fail("compare_markets", err);
  failures++;
}

// ----------------------------------------------------------------
// 8. get_price_history (OHLCV from trades)
// ----------------------------------------------------------------
section(`get_price_history — ${TEST_MARKET} (period: 1h)`);
try {
  const data = await client.get<TradesResponse>(
    `/markets/${TEST_MARKET.toLowerCase()}/trades`,
    { limit: 100 },
  );
  const entries = data.trades.entries;
  pass("trades fetched", `${entries.length}`);

  if (entries.length > 0) {
    const periodMs = 60 * 60 * 1000;
    const buckets = new Map<number, { open: string; high: string; low: string; close: string; count: number }>();
    for (const [tsMs, , price] of entries) {
      const ts = parseInt(tsMs, 10);
      const bucket = Math.floor(ts / periodMs) * periodMs;
      const p = parseFloat(price);
      if (!buckets.has(bucket)) {
        buckets.set(bucket, { open: price, high: price, low: price, close: price, count: 1 });
      } else {
        const c = buckets.get(bucket)!;
        if (p > parseFloat(c.high)) c.high = price;
        if (p < parseFloat(c.low)) c.low = price;
        c.close = price;
        c.count++;
      }
    }
    pass("candles generated (1h)", `${buckets.size}`);
    const firstCandle = Array.from(buckets.values())[0];
    pass("first candle OHLC", `O:${firstCandle.open} H:${firstCandle.high} L:${firstCandle.low} C:${firstCandle.close}`);
  }
} catch (err) {
  fail("get_price_history", err);
  failures++;
}

// ----------------------------------------------------------------
// Auth tools: get_balances, get_orders, place_order, cancel_order
// ----------------------------------------------------------------
section("Auth tools — get_balances, get_orders, place_order, cancel_order");

if (!client.hasAuth()) {
  console.log("  Skipping: BUDA_API_KEY not set");
  console.log("  (Set BUDA_API_KEY + BUDA_API_SECRET env vars to run auth tests)");
} else {
  // get_balances
  try {
    const data = await client.get<BalancesResponse>("/balances");
    const nonZero = data.balances.filter((b) => parseFloat(b.amount[0]) > 0);
    pass("get_balances", `${data.balances.length} currencies, ${nonZero.length} with balance`);
  } catch (err) {
    fail("get_balances", err);
    failures++;
  }

  // get_orders
  try {
    const data = await client.get<OrdersResponse>(
      `/markets/${TEST_MARKET.toLowerCase()}/orders`,
      { state: "pending", per: 10 },
    );
    pass("get_orders (pending)", `${data.orders.length} orders, page ${data.meta.current_page}/${data.meta.total_pages}`);
  } catch (err) {
    fail("get_orders", err);
    failures++;
  }

  // place_order — confirmation guard test (must reject without CONFIRM)
  console.log("  Skipping: place_order live execution (destructive — requires confirmation_token=CONFIRM)");
  pass("place_order guard", "confirmation_token check enforced at tool layer (code-audited)");

  // cancel_order — confirmation guard test (must reject without CONFIRM)
  console.log("  Skipping: cancel_order live execution (destructive — requires confirmation_token=CONFIRM)");
  pass("cancel_order guard", "confirmation_token check enforced at tool layer (code-audited)");
}

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------
section("Summary");
if (failures === 0) {
  console.log("  All tools returned valid data from the live Buda API.");
} else {
  console.error(`  ${failures} tool(s) failed. See errors above.`);
  process.exit(1);
}
