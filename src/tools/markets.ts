import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { MarketsResponse, MarketResponse } from "../types.js";

export const toolSchema = {
  name: "get_markets",
  description:
    "Lists all available trading pairs on Buda.com, or returns details for a specific market " +
    "(base/quote currencies, taker/maker fees as decimals, minimum order size in base currency, " +
    "and fee discount tiers). Omit market_id to get all ~26 markets at once. " +
    "Example: 'What is the taker fee and minimum order size for BTC-CLP?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Optional market ID (e.g. 'BTC-CLP', 'ETH-BTC'). Omit to list all markets.",
      },
    },
  },
};

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .optional()
        .describe(
          "Optional market ID (e.g. 'BTC-CLP', 'ETH-BTC'). Omit to list all markets.",
        ),
    },
    async ({ market_id }) => {
      try {
        if (market_id) {
          const validationError = validateMarketId(market_id);
          if (validationError) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
              isError: true,
            };
          }

          const id = market_id.toLowerCase();
          const data = await cache.getOrFetch<MarketResponse>(
            `market:${id}`,
            CACHE_TTL.MARKETS,
            () => client.get<MarketResponse>(`/markets/${id}`),
          );
          return {
            content: [{ type: "text", text: JSON.stringify(data.market, null, 2) }],
          };
        }

        const data = await cache.getOrFetch<MarketsResponse>(
          "markets",
          CACHE_TTL.MARKETS,
          () => client.get<MarketsResponse>("/markets"),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data.markets, null, 2) }],
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
