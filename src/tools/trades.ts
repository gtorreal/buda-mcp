import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient } from "../client.js";
import type { TradesResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_trades",
    "Get recent trade history for a Buda.com market. Each entry contains " +
      "[timestamp_ms, amount, price, direction]. Direction is 'buy' or 'sell'.",
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
      const params: Record<string, string | number> = {};
      if (limit !== undefined) params.limit = limit;
      if (timestamp !== undefined) params.timestamp = timestamp;

      const data = await client.get<TradesResponse>(
        `/markets/${market_id.toLowerCase()}/trades`,
        Object.keys(params).length > 0 ? params : undefined,
      );

      return {
        content: [{ type: "text", text: JSON.stringify(data.trades, null, 2) }],
      };
    },
  );
}
