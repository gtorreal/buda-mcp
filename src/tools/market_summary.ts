import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import { flattenAmount, getLiquidityRating } from "../utils.js";
import type { TickerResponse, VolumeResponse } from "../types.js";

export const toolSchema = {
  name: "get_market_summary",
  description:
    "One-call summary of everything relevant about a market: last price, best bid/ask, spread %, " +
    "24h volume, 24h and 7d price change, and a liquidity_rating ('high' / 'medium' / 'low' based on " +
    "spread thresholds: < 0.3% = high, 0.3–1% = medium, > 1% = low). All prices and volumes are floats. " +
    "Best first tool to call when a user asks about any specific market. " +
    "Example: 'Give me a complete overview of the BTC-CLP market right now.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-COP', 'BTC-PEN').",
      },
    },
    required: ["market_id"],
  },
};

export interface MarketSummaryResult {
  market_id: string;
  last_price: number;
  last_price_currency: string;
  bid: number;
  ask: number;
  spread_pct: number;
  volume_24h: number;
  volume_24h_currency: string;
  price_change_24h: number;
  price_change_7d: number;
  liquidity_rating: "high" | "medium" | "low";
}

interface MarketSummaryInput {
  market_id: string;
}

export async function handleMarketSummary(
  { market_id }: MarketSummaryInput,
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const validationError = validateMarketId(market_id);
    if (validationError) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
        isError: true,
      };
    }

    const id = market_id.toLowerCase();

    // Fetch ticker and volume in parallel
    const [tickerData, volumeData] = await Promise.all([
      cache.getOrFetch<TickerResponse>(
        `ticker:${id}`,
        CACHE_TTL.TICKER,
        () => client.get<TickerResponse>(`/markets/${id}/ticker`),
      ),
      client.get<VolumeResponse>(`/markets/${id}/volume`),
    ]);

    const t = tickerData.ticker;
    const v = volumeData.volume;

    const lastPrice = flattenAmount(t.last_price);
    const bid = parseFloat(t.max_bid[0]);
    const ask = parseFloat(t.min_ask[0]);
    const volume24h = flattenAmount(v.ask_volume_24h);

    const spreadAbs = ask - bid;
    const spreadPct = ask > 0 ? parseFloat(((spreadAbs / ask) * 100).toFixed(4)) : 0;

    const result: MarketSummaryResult = {
      market_id: t.market_id,
      last_price: lastPrice.value,
      last_price_currency: lastPrice.currency,
      bid,
      ask,
      spread_pct: spreadPct,
      volume_24h: volume24h.value,
      volume_24h_currency: volume24h.currency,
      price_change_24h: parseFloat((parseFloat(t.price_variation_24h) * 100).toFixed(4)),
      price_change_7d: parseFloat((parseFloat(t.price_variation_7d) * 100).toFixed(4)),
      liquidity_rating: getLiquidityRating(spreadPct),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
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
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-COP', 'BTC-PEN')."),
    },
    (args) => handleMarketSummary(args, client, cache),
  );
}
