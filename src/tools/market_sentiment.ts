import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TickerResponse, VolumeResponse } from "../types.js";

export const toolSchema = {
  name: "get_market_sentiment",
  description:
    "Computes a composite sentiment score (−100 to +100) for a Buda.com market based on " +
    "24h price variation (40%), volume vs 7-day average (35%), and bid/ask spread vs baseline (25%). " +
    "Returns a score, a label (bearish/neutral/bullish), and a full component breakdown. " +
    "Example: 'Is the BTC-CLP market currently bullish or bearish?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-USDT').",
      },
    },
    required: ["market_id"],
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isStablecoinPair(marketId: string): boolean {
  return /-(USDT|USDC|DAI|TUSD)$/i.test(marketId);
}

type MarketSentimentArgs = { market_id: string };

export async function handleMarketSentiment(
  { market_id }: MarketSentimentArgs,
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  try {
    const id = market_id.toLowerCase();

    const [tickerData, volumeData] = await Promise.all([
      cache.getOrFetch<TickerResponse>(
        `ticker:${id}`,
        CACHE_TTL.TICKER,
        () => client.get<TickerResponse>(`/markets/${id}/ticker`),
      ),
      client.get<VolumeResponse>(`/markets/${id}/volume`),
    ]);

    const ticker = tickerData.ticker;
    const vol = volumeData.volume;

    const bid = parseFloat(ticker.max_bid[0]);
    const ask = parseFloat(ticker.min_ask[0]);
    const priceVariation24h = parseFloat(ticker.price_variation_24h);

    const ask24h = parseFloat(vol.ask_volume_24h[0]);
    const bid24h = parseFloat(vol.bid_volume_24h[0]);
    const ask7d = parseFloat(vol.ask_volume_7d[0]);
    const bid7d = parseFloat(vol.bid_volume_7d[0]);

    const spreadPct = ask > 0 ? ((ask - bid) / ask) * 100 : 0;
    const spreadBaseline = isStablecoinPair(market_id) ? 0.3 : 1.0;

    const volume24h = ask24h + bid24h;
    const volume7d = ask7d + bid7d;
    const volumeRatio = volume7d > 0 ? (volume24h * 7) / volume7d : 1;

    // Price component: ±5% daily change → ±100 on this sub-score
    const priceRaw = clamp(priceVariation24h * 2000, -100, 100);
    const priceScore = parseFloat((priceRaw * 0.4).toFixed(4));

    // Volume component: ratio vs 7d daily average
    const volumeRaw = clamp((volumeRatio - 1) * 100, -100, 100);
    const volumeScore = parseFloat((volumeRaw * 0.35).toFixed(4));

    // Spread component: tighter spread is bullish
    const spreadRaw = clamp((1 - spreadPct / spreadBaseline) * 100, -100, 100);
    const spreadScore = parseFloat((spreadRaw * 0.25).toFixed(4));

    const score = parseFloat((priceScore + volumeScore + spreadScore).toFixed(1));
    const label: "bearish" | "neutral" | "bullish" =
      score < -20 ? "bearish" : score > 20 ? "bullish" : "neutral";

    const result = {
      market_id: ticker.market_id,
      score,
      label,
      component_breakdown: {
        price_variation_24h_pct: parseFloat((priceVariation24h * 100).toFixed(4)),
        volume_ratio: parseFloat(volumeRatio.toFixed(4)),
        spread_pct: parseFloat(spreadPct.toFixed(4)),
        spread_baseline_pct: spreadBaseline,
        price_score: priceScore,
        volume_score: volumeScore,
        spread_score: spreadScore,
      },
      data_timestamp: new Date().toISOString(),
      disclaimer:
        "Sentiment is derived from market microstructure data only. Not investment advice.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-USDT')."),
    },
    (args) => handleMarketSentiment(args, client, cache),
  );
}
