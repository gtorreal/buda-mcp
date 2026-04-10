import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import type { VolumeResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient, _cache: MemoryCache): void {
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
      try {
        const data = await client.get<VolumeResponse>(
          `/markets/${market_id.toLowerCase()}/volume`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data.volume, null, 2) }],
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
