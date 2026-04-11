import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { OrdersResponse, Amount } from "../types.js";

export const toolSchema = {
  name: "get_orders",
  description:
    "Returns orders for a given Buda.com market as flat typed objects. All monetary amounts are floats " +
    "with separate _currency fields (e.g. amount + amount_currency). Filterable by state: pending, " +
    "active, traded, canceled. Supports pagination via per and page. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Show my open limit orders on BTC-CLP.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      state: {
        type: "string",
        description:
          "Filter by order state: 'pending', 'active', 'traded', 'canceled', 'canceled_and_traded'.",
      },
      per: {
        type: "number",
        description: "Results per page (default: 20, max: 300).",
      },
      page: {
        type: "number",
        description: "Page number (default: 1).",
      },
    },
    required: ["market_id"],
  },
};

function flattenAmountField(amount: Amount): { value: number; currency: string } {
  return flattenAmount(amount);
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
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
        const validationError = validateMarketId(market_id);
        if (validationError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
            isError: true,
          };
        }

        const params: Record<string, string | number> = {};
        if (state) params.state = state;
        if (per !== undefined) params.per = per;
        if (page !== undefined) params.page = page;

        const data = await client.get<OrdersResponse>(
          `/markets/${market_id.toLowerCase()}/orders`,
          Object.keys(params).length > 0 ? params : undefined,
        );

        const orders = data.orders.map((o) => {
          const amount = flattenAmountField(o.amount);
          const originalAmount = flattenAmountField(o.original_amount);
          const tradedAmount = flattenAmountField(o.traded_amount);
          const totalExchanged = flattenAmountField(o.total_exchanged);
          const paidFee = flattenAmountField(o.paid_fee);
          const limitPrice = o.limit ? flattenAmountField(o.limit) : null;

          return {
            id: o.id,
            type: o.type,
            state: o.state,
            created_at: o.created_at,
            market_id: o.market_id,
            fee_currency: o.fee_currency,
            price_type: o.price_type,
            order_type: o.order_type,
            client_id: o.client_id,
            limit_price: limitPrice ? limitPrice.value : null,
            limit_price_currency: limitPrice ? limitPrice.currency : null,
            amount: amount.value,
            amount_currency: amount.currency,
            original_amount: originalAmount.value,
            original_amount_currency: originalAmount.currency,
            traded_amount: tradedAmount.value,
            traded_amount_currency: tradedAmount.currency,
            total_exchanged: totalExchanged.value,
            total_exchanged_currency: totalExchanged.currency,
            paid_fee: paidFee.value,
            paid_fee_currency: paidFee.currency,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ orders, meta: data.meta }, null, 2),
            },
          ],
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
