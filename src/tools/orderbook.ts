import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient } from "../client.js";
import type { OrderBookResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_orderbook",
    "Get the current order book for a Buda.com market. Returns sorted arrays of " +
      "bids (buy orders) and asks (sell orders), each as [price, amount] pairs.",
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
      const data = await client.get<OrderBookResponse>(
        `/markets/${market_id.toLowerCase()}/order_book`,
      );

      const book = data.order_book;
      const result = {
        bids: limit ? book.bids.slice(0, limit) : book.bids,
        asks: limit ? book.asks.slice(0, limit) : book.asks,
        bid_count: book.bids.length,
        ask_count: book.asks.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
