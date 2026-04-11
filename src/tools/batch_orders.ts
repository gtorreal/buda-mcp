import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import { logAudit } from "../audit.js";
import type { OrderResponse } from "../types.js";

export const toolSchema = {
  name: "place_batch_orders",
  description:
    "Place multiple orders sequentially on Buda.com (up to 20). " +
    "All orders are pre-validated before any API call — a validation failure stops execution with zero orders placed. " +
    "Partial API failures do NOT roll back already-placed orders. " +
    "Use max_notional to cap total exposure (computed as sum of amount × limit_price for limit orders; market orders contribute 0). " +
    "IMPORTANT: Pass confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      orders: {
        type: "array",
        description: "Array of 1–20 orders to place.",
        items: {
          type: "object",
          properties: {
            market_id: { type: "string", description: "Market ID (e.g. 'BTC-CLP')." },
            type: { type: "string", enum: ["Bid", "Ask"], description: "Order side." },
            price_type: { type: "string", enum: ["limit", "market"], description: "Order type." },
            amount: { type: "number", description: "Order size in base currency." },
            limit_price: { type: "number", description: "Required when price_type is 'limit'." },
          },
          required: ["market_id", "type", "price_type", "amount"],
        },
      },
      max_notional: {
        type: "number",
        description:
          "Optional spending cap: total notional (sum of amount × limit_price for limit orders). " +
          "Batch is rejected before any API call if the sum exceeds this value. " +
          "Market orders contribute 0 to the notional since their execution price is unknown.",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute.",
      },
    },
    required: ["orders", "confirmation_token"],
  },
};

const orderShape = z.object({
  market_id: z.string(),
  type: z.enum(["Bid", "Ask"]),
  price_type: z.enum(["limit", "market"]),
  amount: z.number().positive(),
  limit_price: z.number().positive().optional(),
});

type SingleOrderInput = z.infer<typeof orderShape>;

type BatchResult = {
  index: number;
  market_id: string;
  success: boolean;
  order?: unknown;
  error?: string;
  code?: number | string;
};

type BatchOrdersArgs = {
  orders: SingleOrderInput[];
  max_notional?: number;
  confirmation_token: string;
};

export async function handlePlaceBatchOrders(
  args: BatchOrdersArgs,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { orders, max_notional, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Orders not placed. confirmation_token must equal 'CONFIRM' to execute. " +
              "Review all orders and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            preview: { order_count: orders.length },
          }),
        },
      ],
      isError: true,
    };
  }

  // Pre-validate ALL orders before any API call
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const marketError = validateMarketId(order.market_id);
    if (marketError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Order at index ${i}: ${marketError}`,
              code: "INVALID_MARKET_ID",
              index: i,
            }),
          },
        ],
        isError: true,
      };
    }
    if (order.price_type === "limit" && order.limit_price === undefined) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Order at index ${i}: limit_price is required when price_type is 'limit'.`,
              code: "VALIDATION_ERROR",
              index: i,
            }),
          },
        ],
        isError: true,
      };
    }
  }

  // Notional cap check (limit orders only; market orders have unknown execution price)
  if (max_notional !== undefined) {
    const totalNotional = orders.reduce((sum, o) => {
      return sum + (o.price_type === "limit" && o.limit_price ? o.amount * o.limit_price : 0);
    }, 0);
    if (totalNotional > max_notional) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Total notional ${totalNotional} exceeds max_notional cap of ${max_notional}. No orders were placed.`,
            code: "NOTIONAL_CAP_EXCEEDED",
            total_notional: totalNotional,
            max_notional,
          }),
        }],
        isError: true,
      };
    }
  }

  // Execute sequentially
  const results: BatchResult[] = [];
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    try {
      const payload: Record<string, unknown> = {
        type: order.type,
        price_type: order.price_type,
        amount: order.amount,
      };
      if (order.price_type === "limit") {
        payload.limit = { price: order.limit_price, type: "gtc" };
      }

      const data = await client.post<OrderResponse>(
        `/markets/${order.market_id.toLowerCase()}/orders`,
        payload,
      );
      results.push({ index: i, market_id: order.market_id, success: true, order: data.order });
    } catch (err) {
      const errInfo =
        err instanceof BudaApiError
          ? { error: err.message, code: err.status as number | string }
          : { error: String(err), code: "UNKNOWN" as const };
      results.push({
        index: i,
        market_id: order.market_id,
        success: false,
        error: errInfo.error,
        code: errInfo.code,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const response: Record<string, unknown> = {
    results,
    total: orders.length,
    succeeded,
    failed,
  };

  if (failed > 0 && succeeded > 0) {
    response.warning = "Some orders failed. Already-placed orders were NOT rolled back.";
  }

  const isError = failed > 0 && succeeded === 0 ? true : undefined;
  logAudit({
    ts: new Date().toISOString(),
    tool: "place_batch_orders",
    transport,
    args_summary: { order_count: orders.length, succeeded, failed },
    success: !isError,
    error_code: isError ? "PARTIAL_OR_FULL_FAILURE" : undefined,
  });
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError,
  };
}

export function register(
  server: McpServer,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      orders: z
        .array(orderShape)
        .min(1)
        .max(20)
        .describe("Array of 1–20 orders to place."),
      max_notional: z
        .number()
        .positive()
        .optional()
        .describe(
          "Optional spending cap: total notional (sum of amount × limit_price for limit orders). " +
          "Batch is rejected before any API call if the sum exceeds this value. " +
          "Market orders contribute 0 to the notional since their execution price is unknown.",
        ),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute.",
        ),
    },
    (args) => handlePlaceBatchOrders(args, client, transport),
  );
}
