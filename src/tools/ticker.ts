import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TickerResponse } from "../types.js";

export const toolSchema = {
  name: "get_ticker",
  description:
    "Get the current ticker for a Buda.com market: last traded price, best bid/ask, " +
    "24h volume, and price change over 24h and 7d.",
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
        return {
          content: [{ type: "text", text: JSON.stringify(data.ticker, null, 2) }],
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
