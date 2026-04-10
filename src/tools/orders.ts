import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import type { OrdersResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_orders",
    "Get orders for a given Buda.com market. Filter by state (pending, active, traded, canceled). " +
      "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      state: z
        .enum(["pending", "active", "traded", "canceled", "canceled_and_traded"])
        .optional()
        .describe(
          "Filter by order state. Omit to return all orders. " +
            "Values: 'pending', 'active', 'traded', 'canceled', 'canceled_and_traded'.",
        ),
      per: z
        .number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .describe("Results per page (default: 20, max: 300)."),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1)."),
    },
    async ({ market_id, state, per, page }) => {
      try {
        const params: Record<string, string | number> = {};
        if (state) params.state = state;
        if (per !== undefined) params.per = per;
        if (page !== undefined) params.page = page;

        const data = await client.get<OrdersResponse>(
          `/markets/${market_id.toLowerCase()}/orders`,
          Object.keys(params).length > 0 ? params : undefined,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ orders: data.orders, meta: data.meta }, null, 2),
            },
          ],
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
