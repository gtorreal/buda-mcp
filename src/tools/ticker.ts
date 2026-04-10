import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient } from "../client.js";
import type { TickerResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_ticker",
    "Get the current ticker for a Buda.com market: last traded price, best bid/ask, " +
      "24h volume, and price change over 24h and 7d.",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-COP')."),
    },
    async ({ market_id }) => {
      const data = await client.get<TickerResponse>(
        `/markets/${market_id.toLowerCase()}/ticker`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data.ticker, null, 2) }],
      };
    },
  );
}
