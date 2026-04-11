import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { TickerResponse } from "../types.js";

export const toolSchema = {
  name: "get_ticker",
  description:
    "Returns the current market snapshot for a Buda.com market: last traded price, best bid, " +
    "best ask, 24h volume, and price change over 24h and 7d. All prices are floats in the quote " +
    "currency (e.g. CLP for BTC-CLP). price_variation_24h is a decimal fraction (0.012 = +1.2%). " +
    "Example: 'What is the current Bitcoin price in Chilean pesos?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-COP').",
      },
    },
    required: ["market_id"],
  },
};

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-COP')."),
    },
    async ({ market_id }) => {
      try {
        const validationError = validateMarketId(market_id);
        if (validationError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
            isError: true,
          };
        }

        const id = market_id.toLowerCase();
        const data = await cache.getOrFetch<TickerResponse>(
          `ticker:${id}`,
          CACHE_TTL.TICKER,
          () => client.get<TickerResponse>(`/markets/${id}/ticker`),
        );

        const t = data.ticker;
        const lastPrice = flattenAmount(t.last_price);
        const minAsk = flattenAmount(t.min_ask);
        const maxBid = flattenAmount(t.max_bid);
        const volume = flattenAmount(t.volume);

        const result = {
          market_id: t.market_id,
          last_price: lastPrice.value,
          last_price_currency: lastPrice.currency,
          min_ask: minAsk.value,
          min_ask_currency: minAsk.currency,
          max_bid: maxBid.value,
          max_bid_currency: maxBid.currency,
          volume: volume.value,
          volume_currency: volume.currency,
          price_variation_24h: parseFloat(t.price_variation_24h),
          price_variation_7d: parseFloat(t.price_variation_7d),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg =
          err instanceof BudaApiError
            ? { error: err.message, code: err.status, path: err.path }
            : { error: String(err), code: "UNKNOWN" };
        return {
          content: [{ type: "text", text: JSON.stringify(msg) }],
          isError: true,
        };
      }
    },
  );
}
