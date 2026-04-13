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

/**
 * Generates a one-line Spanish insight for a single market based on spread rank and depth.
 * "Effective" markets are those that can fill at least the $50k size on both sides.
 */
export function marketInsight(r: MarketResult, allResults: MarketResult[]): string {
  const effective = allResults.filter((m) => !m.slippage["usd_50k"].insufficient_liquidity);
  const sortedEffective = [...effective].sort((a, b) => a.spread_pct - b.spread_pct);
  const effectiveRank = sortedEffective.findIndex((m) => m.market_id === r.market_id);

  const s50k = r.slippage["usd_50k"];
  const s100k = r.slippage["usd_100k"];
  const deepAt50k = !s50k.insufficient_liquidity;
  const deepAt100k = !s100k.insufficient_liquidity;

  // Largest size tier where buy slippage is exactly zero
  let maxZeroBuyLabel: string | null = null;
  for (const key of SIZE_KEYS) {
    const s = r.slippage[key];
    if (!s.insufficient_liquidity && s.buy_pct === 0) {
      maxZeroBuyLabel = SIZE_LABELS[key];
    }
  }

  // Sell slippage magnitudes at key tiers (null when tier is unavailable)
  const sell50kAbs = deepAt50k ? Math.abs((s50k as { sell_pct: number }).sell_pct) : null;
  const sell100kAbs = deepAt100k ? Math.abs((s100k as { sell_pct: number }).sell_pct) : null;

  // Best effective market
  if (effectiveRank === 0) {
    const depthNote =
      maxZeroBuyLabel === "$100k"
        ? "Spread mínimo, sin impacto de precio al comprar hasta $100k."
        : maxZeroBuyLabel
          ? `Spread mínimo, sin impacto de precio al comprar hasta ${maxZeroBuyLabel}.`
          : "Spread mínimo.";
    return `El más líquido del exchange. ${depthNote}`;
  }

  // Second best effective market with a comparable spread profile
  if (effectiveRank === 1 && r.spread_pct < 0.5) {
    const bestId = sortedEffective[0].market_id;
    return `Muy líquido también. Spread ligeramente mayor que ${bestId} pero igual de profundo.`;
  }

  // High-spread markets
  if (r.spread_pct >= 1.0) {
    if (!deepAt50k) {
      return "Spread amplio y poca profundidad. Liquidez insuficiente para órdenes mayores a $10k.";
    }
    return "Spread amplio. Slippage elevado en órdenes grandes, no recomendable para montos altos.";
  }

  // Mid-tier: good to $50k but sell degrades badly at $100k
  if (deepAt50k && !deepAt100k) {
    if (sell50kAbs !== null && sell50kAbs < 1) {
      return "Buena liquidez hasta $50k. Sin profundidad suficiente para cubrir $100k.";
    }
    return "Liquidez moderada hasta $50k. Profundidad insuficiente para $100k.";
  }

  // Good to $100k but sell spikes there
  if (deepAt100k && sell100kAbs !== null && sell100kAbs > 5) {
    return "Buena liquidez hasta $50k. A $100k el sell slippage se dispara, el libro de bids es delgado en esa profundidad.";
  }

  // No depth even at $50k
  if (!deepAt50k) {
    return "Poca profundidad. Liquidez insuficiente para órdenes mayores a $5k.";
  }

  return "Buena liquidez en todos los tamaños.";
}

export function formatStableLiquidity(results: MarketResult[]): string {
  const timestamp = results[0]?.data_timestamp
    ? fmtTimestamp(results[0].data_timestamp)
    : new Date().toUTCString();

  const sections = results.map((r) => {
    const badge = liquidityBadge(r.spread_pct);
    const header = `### ${r.market_id} — Spread ${r.spread_pct}% ${badge}`;
    const prices = `Bid: ${r.best_bid.toLocaleString("en-US")} | Ask: ${r.best_ask.toLocaleString("en-US")} ${r.quote_currency}`;

    const tableHeader = "| Tamaño | Buy slippage | Sell slippage |";
    const tableSep =   "|--------|-------------|---------------|";
    const rows = SIZE_KEYS.map((key) => {
      const s = r.slippage[key];
      const buy = s.insufficient_liquidity ? "—" : fmtSlippage(s.buy_pct);
      const sell = s.insufficient_liquidity ? "—" : fmtSlippage(s.sell_pct);
      return `| ${SIZE_LABELS[key].padEnd(6)} | ${buy.padEnd(11)} | ${sell.padEnd(13)} |`;
    });

    const insight = marketInsight(r, results);

    return [header, prices, "", tableHeader, tableSep, ...rows, "", `_${insight}_`].join("\n");
  });

  return [
    "## Stablecoin Liquidity — Buda.com",
    `_Actualizado: ${timestamp}_`,
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
