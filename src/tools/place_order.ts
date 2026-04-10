import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import type { OrderResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "place_order",
    "Place a limit or market order on Buda.com. " +
      "IMPORTANT: To prevent accidental execution from ambiguous prompts, you must pass " +
      "confirmation_token='CONFIRM' to execute the order. " +
      "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables. " +
      "WARNING: Only use this tool on a locally-run instance — never on a publicly exposed server.",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      type: z
        .enum(["Bid", "Ask"])
        .describe("Order side: 'Bid' to buy, 'Ask' to sell."),
      price_type: z
        .enum(["limit", "market"])
        .describe("Order type: 'limit' places at a specific price, 'market' executes immediately."),
      amount: z
        .number()
        .positive()
        .describe("Order size in the market's base currency (e.g. BTC amount for BTC-CLP)."),
      limit_price: z
        .number()
        .positive()
        .optional()
        .describe(
          "Limit price in quote currency. Required when price_type is 'limit'. " +
            "For Bid orders: highest price you will pay. For Ask orders: lowest price you will accept.",
        ),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute the order. " +
            "Any other value will reject the request without placing an order.",
        ),
    },
    async ({ market_id, type, price_type, amount, limit_price, confirmation_token }) => {
      if (confirmation_token !== "CONFIRM") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error:
                  "Order not placed. confirmation_token must equal 'CONFIRM' to execute. " +
                  "Review the order details and set confirmation_token='CONFIRM' to proceed.",
                code: "CONFIRMATION_REQUIRED",
                order_preview: { market_id, type, price_type, amount, limit_price },
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const payload: Record<string, unknown> = {
          type,
          price_type,
          amount,
        };

        if (price_type === "limit") {
          if (limit_price === undefined) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "limit_price is required when price_type is 'limit'.",
                    code: "VALIDATION_ERROR",
                  }),
                },
              ],
              isError: true,
            };
          }
          payload.limit = { price: limit_price, type: "gtc" };
        }

        const data = await client.post<OrderResponse>(
          `/markets/${market_id.toLowerCase()}/orders`,
          payload,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(data.order, null, 2) }],
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
