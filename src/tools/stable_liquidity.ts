import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient, formatApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { liquidityBadge, fmtSlippage, fmtTimestamp } from "../format.js";
import type { MarketsResponse, TickerResponse, OrderBookResponse } from "../types.js";

export const toolSchema = {
  name: "get_stable_liquidity",
  description:
    "Returns spread and market-impact slippage for all stablecoin markets on Buda.com " +
    "(USDT-CLP, USDC-CLP, USDT-PEN, USDC-PEN, USDT-COP, USDC-COP, USDT-USDC, etc.). " +
    "Slippage is computed by walking the live order book for five fixed USD notional sizes: " +
    "1k, 5k, 10k, 50k, and 100k. Positive buy_pct means you pay more than the best ask; " +
    "negative sell_pct means you receive less than the best bid. " +
    "null values indicate insufficient order book depth for that size. " +
    "Example: 'How liquid are the stablecoin markets on Buda right now?'",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

const STABLECOIN_BASE_CURRENCIES = new Set(["USDT", "USDC", "DAI", "TUSD"]);
const USD_SIZES = [1_000, 5_000, 10_000, 50_000, 100_000] as const;
const SIZE_KEYS = ["usd_1k", "usd_5k", "usd_10k", "usd_50k", "usd_100k"] as const;

type SizeKey = (typeof SIZE_KEYS)[number];

type SlippageEntry =
  | { buy_pct: number; sell_pct: number; insufficient_liquidity?: never }
  | { buy_pct: null; sell_pct: null; insufficient_liquidity: true };

/**
 * Walks one side of the order book and returns the weighted average fill price
 * for `usdAmount` units of base currency.
 * Returns null if there is insufficient depth to fill the full amount.
 */
export function walkOrderbook(
  levels: [string, string][],
  usdAmount: number,
): number | null {
  let remaining = usdAmount;
  let totalQuote = 0;

  for (const [priceStr, amtStr] of levels) {
    const price = parseFloat(priceStr);
    const amt = parseFloat(amtStr);
    const fill = Math.min(remaining, amt);
    totalQuote += fill * price;
    remaining -= fill;
    if (remaining <= 0) break;
  }

  if (remaining > 0) return null;
  return totalQuote / usdAmount;
}

const SIZE_LABELS: Record<SizeKey, string> = {
  usd_1k: "$1k",
  usd_5k: "$5k",
  usd_10k: "$10k",
  usd_50k: "$50k",
  usd_100k: "$100k",
};

type MarketResult = {
  market_id: string;
  quote_currency: string;
  best_bid: number;
  best_ask: number;
  spread_pct: number;
  slippage: Record<SizeKey, SlippageEntry>;
  data_timestamp: string;
};

export function formatStableLiquidity(results: MarketResult[]): string {
  const timestamp = results[0]?.data_timestamp
    ? fmtTimestamp(results[0].data_timestamp)
    : new Date().toUTCString();

  const sections = results.map((r) => {
    const badge = liquidityBadge(r.spread_pct);
    const header = `### ${r.market_id} — Spread ${r.spread_pct}% ${badge}`;
    const prices = `Bid: ${r.best_bid.toLocaleString("en-US")} | Ask: ${r.best_ask.toLocaleString("en-US")} ${r.quote_currency}`;

    const tableHeader = "| Size   | Buy slippage | Sell slippage |";
    const tableSep =   "|--------|-------------|---------------|";
    const rows = SIZE_KEYS.map((key) => {
      const s = r.slippage[key];
      const buy = s.insufficient_liquidity ? "—" : fmtSlippage(s.buy_pct);
      const sell = s.insufficient_liquidity ? "—" : fmtSlippage(s.sell_pct);
      return `| ${SIZE_LABELS[key].padEnd(6)} | ${buy.padEnd(11)} | ${sell.padEnd(13)} |`;
    });

    return [header, prices, "", tableHeader, tableSep, ...rows].join("\n");
  });

  return [
    "## Stablecoin Liquidity — Buda.com",
    `_Updated: ${timestamp}_`,
    "",
    sections.join("\n\n---\n"),
  ].join("\n");
}

export async function handleStableLiquidity(
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const marketsData = await cache.getOrFetch<MarketsResponse>(
      "markets",
      CACHE_TTL.MARKETS,
      () => client.get<MarketsResponse>("/markets"),
    );

    const stableMarkets = marketsData.markets.filter((m) =>
      STABLECOIN_BASE_CURRENCIES.has(m.base_currency),
    );

    if (stableMarkets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "No stablecoin markets found.", code: "NOT_FOUND" }),
          },
        ],
        isError: true,
      };
    }

    const results = await Promise.all(
      stableMarkets.map(async (market) => {
        const id = market.id.toLowerCase();

        const [tickerData, obData] = await Promise.all([
          cache.getOrFetch<TickerResponse>(
            `ticker:${id}`,
            CACHE_TTL.TICKER,
            () => client.get<TickerResponse>(`/markets/${id}/ticker`),
          ),
          cache.getOrFetch<OrderBookResponse>(
            `orderbook:${id}`,
            CACHE_TTL.ORDERBOOK,
            () => client.get<OrderBookResponse>(`/markets/${id}/order_book`),
          ),
        ]);

        const ticker = tickerData.ticker;
        const book = obData.order_book;

        const bestAsk = parseFloat(ticker.min_ask[0]);
        const bestBid = parseFloat(ticker.max_bid[0]);
        const spreadPct = parseFloat(((bestAsk - bestBid) / bestAsk * 100).toFixed(4));

        const slippage: Record<SizeKey, SlippageEntry> = {} as Record<SizeKey, SlippageEntry>;

        for (let i = 0; i < USD_SIZES.length; i++) {
          const size = USD_SIZES[i];
          const key = SIZE_KEYS[i];

          const avgAsk = walkOrderbook(book.asks, size);
          const avgBid = walkOrderbook(book.bids, size);

          const buyPct = avgAsk !== null
            ? parseFloat(((avgAsk - bestAsk) / bestAsk * 100).toFixed(4))
            : null;
          const sellPct = avgBid !== null
            ? parseFloat(((avgBid - bestBid) / bestBid * 100).toFixed(4))
            : null;

          if (buyPct === null || sellPct === null) {
            slippage[key] = { buy_pct: null, sell_pct: null, insufficient_liquidity: true };
          } else {
            slippage[key] = { buy_pct: buyPct, sell_pct: sellPct };
          }
        }

        return {
          market_id: ticker.market_id,
          quote_currency: market.quote_currency,
          best_bid: parseFloat(bestBid.toFixed(6)),
          best_ask: parseFloat(bestAsk.toFixed(6)),
          spread_pct: spreadPct,
          slippage,
          data_timestamp: new Date().toISOString(),
        };
      }),
    );

    return {
      content: [{ type: "text", text: formatStableLiquidity(results) }],
    };
  } catch (err) {
    const msg = formatApiError(err);
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {},
    () => handleStableLiquidity(client, cache),
  );
}
