import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import type { MarketsResponse, MarketResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    "get_markets",
    "List all available trading pairs on Buda.com, or get details for a specific market. " +
      "Returns base/quote currencies, fees, and minimum order sizes.",
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
