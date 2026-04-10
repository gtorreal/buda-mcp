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
} from "../src/types.js";

const client = new BudaClient();
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
// Summary
// ----------------------------------------------------------------
section("Summary");
if (failures === 0) {
  console.log("  All tools returned valid data from the live Buda API.");
} else {
  console.error(`  ${failures} tool(s) failed. See errors above.`);
  process.exit(1);
}
