import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { VolumeResponse } from "../types.js";

export const toolSchema = {
  name: "get_market_volume",
  description:
    "Get 24h and 7-day transacted volume for a Buda.com market. " +
    "Returns ask (sell) and bid (buy) volumes in the market's base currency.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
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
