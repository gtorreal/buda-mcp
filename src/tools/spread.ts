import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TickerResponse } from "../types.js";

export const toolSchema = {
  name: "get_spread",
  description:
    "Returns the best bid, best ask, absolute spread, and spread percentage for a Buda.com market. " +
    "All prices are floats in the quote currency (e.g. CLP). spread_percentage is a float in percent " +
    "(e.g. 0.15 means 0.15%). Use this to evaluate liquidity before placing a large order. " +
    "Example: 'Is BTC-CLP liquid enough to buy 10M CLP without significant slippage?'",
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

        const ticker = data.ticker;
        const bid = parseFloat(ticker.max_bid[0]);
        const ask = parseFloat(ticker.min_ask[0]);
        const currency = ticker.max_bid[1];

        if (isNaN(bid) || isNaN(ask) || ask === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Unable to calculate spread: invalid bid/ask values" }),
              },
            ],
            isError: true,
          };
        }

        const spreadAbs = ask - bid;
        const spreadPct = (spreadAbs / ask) * 100;

        const result = {
          market_id: ticker.market_id,
          price_currency: currency,
          best_bid: bid,
          best_ask: ask,
          spread_absolute: parseFloat(spreadAbs.toFixed(2)),
          spread_percentage: parseFloat(spreadPct.toFixed(4)),
          last_price: parseFloat(ticker.last_price[0]),
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
