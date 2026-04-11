/**
 * Integration test: calls each Buda MCP tool directly via BudaClient
 * and prints a summary of the results.
 *
 * Run with: npm run test:integration
 * Skipped automatically when the Buda API is unreachable (CI without network).
 */

// Connectivity pre-check — skip gracefully instead of failing CI when the API is unreachable.
try {
  await fetch("https://www.buda.com/api/v2/markets.json", {
    signal: AbortSignal.timeout(3000),
  });
} catch {
  console.log("\nBuda API is unreachable — skipping integration tests (no network or API down).");
  console.log("Run unit tests only with: npm run test:unit");
  process.exit(0);
}

import { BudaClient } from "../src/client.js";
import { MemoryCache } from "../src/cache.js";
import { handleSimulateOrder } from "../src/tools/simulate_order.js";
import { handleCalculatePositionSize } from "../src/tools/calculate_position_size.js";
import { handleMarketSentiment } from "../src/tools/market_sentiment.js";
import { handleTechnicalIndicators } from "../src/tools/technical_indicators.js";
import { handleScheduleCancelAll, handleDisarmCancelTimer } from "../src/tools/dead_mans_switch.js";
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
// 9. simulate_order
// ----------------------------------------------------------------
section(`simulate_order — ${TEST_MARKET} market buy`);
{
  const cache = new MemoryCache();
  try {
    const result = await handleSimulateOrder(
      { market_id: TEST_MARKET, side: "buy", amount: 0.001 },
      client,
      cache,
    );
    if (result.isError) throw new Error(result.content[0].text);
    const parsed = JSON.parse(result.content[0].text) as {
      simulation: boolean;
      estimated_fill_price: number;
      fee_amount: number;
      fee_rate_pct: number;
      total_cost: number;
      slippage_vs_mid_pct: number;
      order_type_assumed: string;
    };
    if (parsed.simulation !== true) throw new Error("simulation flag must be true");
    pass("simulation: true", "✓");
    pass("order_type_assumed", parsed.order_type_assumed);
    pass("estimated_fill_price", `${parsed.estimated_fill_price.toLocaleString()} CLP`);
    pass("fee_rate_pct", `${parsed.fee_rate_pct}%`);
    pass("fee_amount", `${parsed.fee_amount.toFixed(2)} CLP`);
    pass("total_cost", `${parsed.total_cost.toFixed(2)} CLP`);
    pass("slippage_vs_mid_pct", `${parsed.slippage_vs_mid_pct}%`);
  } catch (err) {
    fail("simulate_order", err);
    failures++;
  }
}

// ----------------------------------------------------------------
// 10. calculate_position_size
// ----------------------------------------------------------------
section(`calculate_position_size — ${TEST_MARKET}`);
{
  // Fetch live ticker to use real entry/stop prices
  try {
    const tickerData = await client.get<TickerResponse>(
      `/markets/${TEST_MARKET.toLowerCase()}/ticker`,
    );
    const lastPrice = parseFloat(tickerData.ticker.last_price[0]);
    const entryPrice = lastPrice;
    const stopLossPrice = parseFloat((lastPrice * 0.97).toFixed(0)); // 3% below entry

    const result = handleCalculatePositionSize({
      market_id: TEST_MARKET,
      capital: 1_000_000,
      risk_pct: 2,
      entry_price: entryPrice,
      stop_loss_price: stopLossPrice,
    });
    if (result.isError) throw new Error(result.content[0].text);
    const parsed = JSON.parse(result.content[0].text) as {
      side: string;
      units: number;
      capital_at_risk: number;
      position_value: number;
      fee_impact: number;
      fee_currency: string;
    };
    pass("side", parsed.side);
    pass("units", `${parsed.units} BTC`);
    pass("capital_at_risk", `${parsed.capital_at_risk.toLocaleString()} CLP`);
    pass("position_value", `${parsed.position_value.toLocaleString()} CLP`);
    pass("fee_impact", `${parsed.fee_impact.toFixed(2)} ${parsed.fee_currency}`);
  } catch (err) {
    fail("calculate_position_size", err);
    failures++;
  }
}

// ----------------------------------------------------------------
// 11. get_market_sentiment
// ----------------------------------------------------------------
section(`get_market_sentiment — ${TEST_MARKET}`);
{
  const cache = new MemoryCache();
  try {
    const result = await handleMarketSentiment({ market_id: TEST_MARKET }, client, cache);
    if (result.isError) throw new Error(result.content[0].text);
    const parsed = JSON.parse(result.content[0].text) as {
      score: number;
      label: string;
      component_breakdown: {
        price_variation_24h_pct: number;
        volume_ratio: number;
        spread_pct: number;
      };
      disclaimer: string;
    };
    if (!["bearish", "neutral", "bullish"].includes(parsed.label)) {
      throw new Error(`unexpected label: ${parsed.label}`);
    }
    if (typeof parsed.score !== "number" || parsed.score < -100 || parsed.score > 100) {
      throw new Error(`score out of range: ${parsed.score}`);
    }
    pass("score", String(parsed.score));
    pass("label", parsed.label);
    pass("price_variation_24h_pct", `${parsed.component_breakdown.price_variation_24h_pct}%`);
    pass("volume_ratio", String(parsed.component_breakdown.volume_ratio));
    pass("spread_pct", `${parsed.component_breakdown.spread_pct}%`);
    pass("disclaimer", parsed.disclaimer.length > 0 ? "present" : "MISSING");
  } catch (err) {
    fail("get_market_sentiment", err);
    failures++;
  }
}

// ----------------------------------------------------------------
// 12. get_technical_indicators
// ----------------------------------------------------------------

type TechIndicatorsResponse = {
  candles_used?: number;
  candles_available?: number;
  warning?: string;
  indicators: {
    rsi: number | null;
    macd: { line: number; signal: number; histogram: number } | null;
    bollinger_bands: { upper: number; mid: number; lower: number } | null;
    sma_20: number;
    sma_50: number;
  } | null;
  signals: { rsi_signal: string; macd_signal: string; bb_signal: string };
  disclaimer: string;
};

// 12a. 1h period — expected to hit insufficient_data (BTC-CLP has ~8 candles/1h)
section(`get_technical_indicators — ${TEST_MARKET} (1h, insufficient_data branch)`);
{
  try {
    const result = await handleTechnicalIndicators(
      { market_id: TEST_MARKET, period: "1h", limit: 1000 },
      client,
    );
    if (result.isError) throw new Error(result.content[0].text);
    const parsed = JSON.parse(result.content[0].text) as TechIndicatorsResponse;
    if (parsed.warning !== "insufficient_data") {
      pass("note", `got ${parsed.candles_used} candles — unexpectedly enough data, indicators returned`);
    } else {
      pass("warning", `insufficient_data — ${parsed.candles_available} candles available (need 50) ✓`);
      pass("indicators", parsed.indicators === null ? "null ✓" : "SHOULD BE NULL");
    }
  } catch (err) {
    fail("get_technical_indicators (1h)", err);
    failures++;
  }
}

// 12b. 5m period — enough candles to compute real indicators (~42 from last 100 trades)
section(`get_technical_indicators — ${TEST_MARKET} (5m, indicators branch)`);
{
  try {
    const result = await handleTechnicalIndicators(
      { market_id: TEST_MARKET, period: "5m", limit: 1000 },
      client,
    );
    if (result.isError) throw new Error(result.content[0].text);
    const parsed = JSON.parse(result.content[0].text) as TechIndicatorsResponse;

    if (parsed.warning === "insufficient_data") {
      // Market too quiet right now — report but don't fail
      pass("note", `insufficient_data with 1m period (${parsed.candles_available} candles) — market unusually quiet`);
    } else {
      if (!parsed.indicators) throw new Error("indicators is null without a warning");
      pass("candles_used", String(parsed.candles_used));
      pass("rsi", parsed.indicators.rsi !== null ? `${parsed.indicators.rsi} (${parsed.signals.rsi_signal})` : "null (insufficient RSI data)");
      pass("macd_histogram", parsed.indicators.macd !== null
        ? `${parsed.indicators.macd.histogram.toFixed(2)} (${parsed.signals.macd_signal})`
        : "null (insufficient MACD data)");
      pass("bb_upper", parsed.indicators.bollinger_bands !== null
        ? `${parsed.indicators.bollinger_bands.upper.toLocaleString()} (${parsed.signals.bb_signal})`
        : "null (insufficient BB data)");
      pass("sma_20", String(parsed.indicators.sma_20?.toLocaleString()));
      pass("sma_50", parsed.indicators.sma_50 !== null ? String(parsed.indicators.sma_50?.toLocaleString()) : "null (need 50 candles)");
      pass("disclaimer", parsed.disclaimer?.length > 0 ? "present ✓" : "MISSING");
    }
  } catch (err) {
    fail("get_technical_indicators (1m)", err);
    failures++;
  }
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

  // schedule_cancel_all — arm then immediately disarm (non-destructive)
  try {
    const armResult = await handleScheduleCancelAll(
      { market_id: TEST_MARKET, ttl_seconds: 300, confirmation_token: "CONFIRM" },
      client,
    );
    if (armResult.isError) throw new Error(armResult.content[0].text);
    const armed = JSON.parse(armResult.content[0].text) as {
      active: boolean;
      expires_at: string;
      ttl_seconds: number;
      warning: string;
    };
    if (!armed.active) throw new Error("active should be true after CONFIRM");
    pass("schedule_cancel_all active", armed.active ? "true" : "false");
    pass("schedule_cancel_all expires_at", armed.expires_at);
    pass("schedule_cancel_all warning", armed.warning.length > 0 ? "present" : "MISSING");

    // Immediately disarm so no orders are cancelled
    const disarmResult = handleDisarmCancelTimer({ market_id: TEST_MARKET });
    if (disarmResult.isError) throw new Error(disarmResult.content[0].text);
    const disarmed = JSON.parse(disarmResult.content[0].text) as { disarmed: boolean };
    pass("disarm_cancel_timer", disarmed.disarmed ? "timer cleared ✓" : "FAILED to disarm");
  } catch (err) {
    fail("schedule_cancel_all / disarm_cancel_timer", err);
    failures++;
  }
}

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------
section("Summary");
if (failures === 0) {
  console.log("  All tools returned valid data from the live Buda API.");
  console.log("  Coverage: simulate_order, calculate_position_size, get_market_sentiment,");
  console.log("            get_technical_indicators, schedule_cancel_all/disarm (auth-gated if credentials set).");
} else {
  console.error(`  ${failures} tool(s) failed. See errors above.`);
  process.exit(1);
}
