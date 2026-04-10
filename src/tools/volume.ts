import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient } from "../client.js";
import type { VolumeResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_market_volume",
    "Get 24h and 7-day transacted volume for a Buda.com market. " +
      "Returns ask (sell) and bid (buy) volumes in the market's base currency.",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
    },
    async ({ market_id }) => {
      const data = await client.get<VolumeResponse>(
        `/markets/${market_id.toLowerCase()}/volume`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data.volume, null, 2) }],
      };
    },
  );
}
