import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient } from "../client.js";
import type { MarketsResponse, MarketResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
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
      if (market_id) {
        const data = await client.get<MarketResponse>(
          `/markets/${market_id.toLowerCase()}`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data.market, null, 2) }],
        };
      }

      const data = await client.get<MarketsResponse>("/markets");
      return {
        content: [{ type: "text", text: JSON.stringify(data.markets, null, 2) }],
      };
    },
  );
}
