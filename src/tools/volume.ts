import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import { validateMarketId } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { VolumeResponse } from "../types.js";

export const toolSchema = {
  name: "get_market_volume",
  description:
    "Returns 24h and 7-day transacted volume for a Buda.com market, split by buy (bid) and sell (ask) side. " +
    "All volume values are floats in the base currency (e.g. BTC for BTC-CLP). " +
    "Example: 'How much Bitcoin was sold on BTC-CLP in the last 24 hours?'",
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

        const v = data.volume;
        const ask24 = flattenAmount(v.ask_volume_24h);
        const ask7d = flattenAmount(v.ask_volume_7d);
        const bid24 = flattenAmount(v.bid_volume_24h);
        const bid7d = flattenAmount(v.bid_volume_7d);

        const result = {
          market_id: v.market_id,
          ask_volume_24h: ask24.value,
          ask_volume_24h_currency: ask24.currency,
          ask_volume_7d: ask7d.value,
          ask_volume_7d_currency: ask7d.currency,
          bid_volume_24h: bid24.value,
          bid_volume_24h_currency: bid24.currency,
          bid_volume_7d: bid7d.value,
          bid_volume_7d_currency: bid7d.currency,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg = formatApiError(err);
        return {
          content: [{ type: "text", text: JSON.stringify(msg) }],
          isError: true,
        };
      }
    },
  );
}
