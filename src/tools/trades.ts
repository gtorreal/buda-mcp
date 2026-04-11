import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TradesResponse } from "../types.js";

export const toolSchema = {
  name: "get_trades",
  description:
    "Returns recent trade history for a Buda.com market as typed objects. Each entry has " +
    "timestamp_ms (integer), amount (float, base currency), price (float, quote currency), " +
    "and direction ('buy' or 'sell'). " +
    "Example: 'What was the last executed price for BTC-CLP and was it a buy or sell?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      limit: {
        type: "number",
        description: "Number of trades to return (default: 50, max: 100).",
      },
      timestamp: {
        type: "number",
        description:
          "Unix timestamp (seconds) to paginate from. Returns trades older than this timestamp.",
      },
    },
    required: ["market_id"],
  },
};

export function register(server: McpServer, client: BudaClient, _cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of trades to return (default: 50, max: 100)."),
      timestamp: z
        .number()
        .int()
        .optional()
        .describe(
          "Unix timestamp (seconds) to paginate from. Returns trades older than this timestamp.",
        ),
    },
    async ({ market_id, limit, timestamp }) => {
      try {
        const validationError = validateMarketId(market_id);
        if (validationError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
            isError: true,
          };
        }

        const params: Record<string, string | number> = {};
        if (limit !== undefined) params.limit = limit;
        if (timestamp !== undefined) params.timestamp = timestamp;

        const data = await client.get<TradesResponse>(
          `/markets/${market_id.toLowerCase()}/trades`,
          Object.keys(params).length > 0 ? params : undefined,
        );

        const t = data.trades;
        const result = {
          timestamp: t.timestamp,
          last_timestamp: t.last_timestamp,
          market_id: t.market_id,
          entries: t.entries.map(([tsMs, amount, price, direction]) => ({
            timestamp_ms: parseInt(tsMs, 10),
            amount: parseFloat(amount),
            price: parseFloat(price),
            direction,
          })),
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
    },
  );
}
