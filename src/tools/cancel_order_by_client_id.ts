import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import type { OrderResponse, Order } from "../types.js";

export const toolSchema = {
  name: "cancel_order_by_client_id",
  description:
    "Cancel an open order by its client-assigned ID on Buda.com. " +
    "IMPORTANT: Pass confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      client_id: {
        type: "string",
        description: "The client ID string assigned when placing the order.",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
          "Any other value will reject the request without canceling.",
      },
    },
    required: ["client_id", "confirmation_token"],
  },
};

type CancelOrderByClientIdArgs = {
  client_id: string;
  confirmation_token: string;
};

function normalizeOrder(o: Order) {
  const amount = flattenAmount(o.amount);
  const originalAmount = flattenAmount(o.original_amount);
  const tradedAmount = flattenAmount(o.traded_amount);
  const totalExchanged = flattenAmount(o.total_exchanged);
  const paidFee = flattenAmount(o.paid_fee);
  const limitPrice = o.limit ? flattenAmount(o.limit) : null;

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
}

export async function handleCancelOrderByClientId(
  args: CancelOrderByClientIdArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { client_id, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Order not canceled. confirmation_token must equal 'CONFIRM' to execute. " +
              "Verify the client ID and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            client_id,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const data = await client.put<OrderResponse>(
      `/orders/by-client-id/${encodeURIComponent(client_id)}`,
      { order: { state: "canceling" } },
    );

    return {
      content: [{ type: "text", text: JSON.stringify(normalizeOrder(data.order), null, 2) }],
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
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      client_id: z
        .string()
        .min(1)
        .describe("The client ID string assigned when placing the order."),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
            "Any other value will reject the request without canceling.",
        ),
    },
    (args) => handleCancelOrderByClientId(args, client),
  );
}
