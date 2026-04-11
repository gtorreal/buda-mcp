import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import type { OrderResponse, Order } from "../types.js";

export const getOrderToolSchema = {
  name: "get_order",
  description:
    "Returns a single order by its numeric ID on Buda.com. " +
    "Fetches full detail including state, amounts, fees, and timestamps. " +
    "All monetary amounts are floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Show me the details of order 987654.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      order_id: {
        type: "number",
        description: "The numeric ID of the order.",
      },
    },
    required: ["order_id"],
  },
};

export const getOrderByClientIdToolSchema = {
  name: "get_order_by_client_id",
  description:
    "Returns an order by the client-assigned ID you set at placement on Buda.com. " +
    "All monetary amounts are floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Find my order with client ID my-bot-order-42.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      client_id: {
        type: "string",
        description: "The client ID string assigned when placing the order.",
      },
    },
    required: ["client_id"],
  },
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

export async function handleGetOrder(
  args: { order_id: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await client.get<OrderResponse>(`/orders/${args.order_id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(normalizeOrder(data.order), null, 2) }],
    };
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export async function handleGetOrderByClientId(
  args: { client_id: string },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await client.get<OrderResponse>(`/orders/by-client-id/${encodeURIComponent(args.client_id)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(normalizeOrder(data.order), null, 2) }],
    };
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    getOrderToolSchema.name,
    getOrderToolSchema.description,
    {
      order_id: z.number().int().positive().describe("The numeric ID of the order."),
    },
    (args) => handleGetOrder(args, client),
  );

  server.tool(
    getOrderByClientIdToolSchema.name,
    getOrderByClientIdToolSchema.description,
    {
      client_id: z.string().min(1).describe("The client ID string assigned when placing the order."),
    },
    (args) => handleGetOrderByClientId(args, client),
  );
}
