import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { OrderBookResponse } from "../types.js";

export const toolSchema = {
  name: "get_orderbook",
  description:
    "Returns the current order book for a Buda.com market as typed objects with float price and amount fields. " +
    "Bids are sorted highest-price first; asks lowest-price first. " +
    "Prices are in the quote currency; amounts are in the base currency. " +
    "Example: 'What are the top 5 buy and sell orders for BTC-CLP right now?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      limit: {
        type: "number",
        description: "Maximum number of levels to return per side (default: all).",
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
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of levels to return per side (default: all)."),
    },
    async ({ market_id, limit }) => {
      try {
        const validationError = validateMarketId(market_id);
        if (validationError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
            isError: true,
          };
        }

        const id = market_id.toLowerCase();
        const data = await cache.getOrFetch<OrderBookResponse>(
          `orderbook:${id}`,
          CACHE_TTL.ORDERBOOK,
          () => client.get<OrderBookResponse>(`/markets/${id}/order_book`),
        );

        const book = data.order_book;
        const bids = limit ? book.bids.slice(0, limit) : book.bids;
        const asks = limit ? book.asks.slice(0, limit) : book.asks;

        const result = {
          bids: bids.map(([price, amount]) => ({
            price: parseFloat(price),
            amount: parseFloat(amount),
          })),
          asks: asks.map(([price, amount]) => ({
            price: parseFloat(price),
            amount: parseFloat(amount),
          })),
          bid_count: book.bids.length,
          ask_count: book.asks.length,
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
