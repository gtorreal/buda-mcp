import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import { logAudit } from "../audit.js";
import type { OrderResponse } from "../types.js";

export const toolSchema = {
  name: "place_order",
  description:
    "Place a limit or market order on Buda.com. " +
    "Supports optional time-in-force flags (ioc, fok, post_only, gtd_timestamp) and stop orders. " +
    "IMPORTANT: To prevent accidental execution from ambiguous prompts, you must pass " +
    "confirmation_token='CONFIRM' to execute the order. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables. " +
    "WARNING: Only use this tool on a locally-run instance — never on a publicly exposed server.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      type: {
        type: "string",
        description: "Order side: 'Bid' to buy, 'Ask' to sell.",
      },
      price_type: {
        type: "string",
        description: "Order type: 'limit' places at a specific price, 'market' executes immediately.",
      },
      amount: {
        type: "number",
        description: "Order size in the market's base currency (e.g. BTC amount for BTC-CLP).",
      },
      limit_price: {
        type: "number",
        description:
          "Limit price in quote currency. Required when price_type is 'limit'. " +
          "For Bid orders: highest price you will pay. For Ask orders: lowest price you will accept.",
      },
      ioc: {
        type: "boolean",
        description: "Immediate-or-cancel: fill as much as possible, cancel the rest. Mutually exclusive with fok, post_only, gtd_timestamp.",
      },
      fok: {
        type: "boolean",
        description: "Fill-or-kill: fill the entire order or cancel it entirely. Mutually exclusive with ioc, post_only, gtd_timestamp.",
      },
      post_only: {
        type: "boolean",
        description: "Post-only: rejected if it would execute immediately as a taker. Mutually exclusive with ioc, fok, gtd_timestamp.",
      },
      gtd_timestamp: {
        type: "string",
        description: "Good-till-date: ISO 8601 datetime after which the order is canceled. Mutually exclusive with ioc, fok, post_only.",
      },
      stop_price: {
        type: "number",
        description: "Stop trigger price. Must be paired with stop_type.",
      },
      stop_type: {
        type: "string",
        description: "Stop trigger direction: '>=' triggers when price rises to stop_price, '<=' when it falls. Must be paired with stop_price.",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute the order. " +
          "Any other value will reject the request without placing an order.",
      },
    },
    required: ["market_id", "type", "price_type", "amount", "confirmation_token"],
  },
};

type PlaceOrderArgs = {
  market_id: string;
  type: "Bid" | "Ask";
  price_type: "limit" | "market";
  amount: number;
  limit_price?: number;
  ioc?: boolean;
  fok?: boolean;
  post_only?: boolean;
  gtd_timestamp?: string;
  stop_price?: number;
  stop_type?: ">=" | "<=";
  confirmation_token: string;
};

export async function handlePlaceOrder(
  args: PlaceOrderArgs,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const {
    market_id,
    type,
    price_type,
    amount,
    limit_price,
    ioc,
    fok,
    post_only,
    gtd_timestamp,
    stop_price,
    stop_type,
    confirmation_token,
  } = args;

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

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  // Validate TIF mutual exclusivity
  const tifFlags = [ioc, fok, post_only, gtd_timestamp !== undefined].filter(Boolean);
  if (tifFlags.length > 1) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "ioc, fok, post_only, and gtd_timestamp are mutually exclusive. Specify at most one.",
            code: "VALIDATION_ERROR",
          }),
        },
      ],
      isError: true,
    };
  }

  // Validate stop_price / stop_type must both be present or both absent
  const hasStopPrice = stop_price !== undefined;
  const hasStopType = stop_type !== undefined;
  if (hasStopPrice !== hasStopType) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "stop_price and stop_type must both be provided together.",
            code: "VALIDATION_ERROR",
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

      if (gtd_timestamp !== undefined) {
        const ts = new Date(gtd_timestamp).getTime();
        if (isNaN(ts)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "gtd_timestamp must be a valid ISO 8601 datetime string.",
                  code: "VALIDATION_ERROR",
                }),
              },
            ],
            isError: true,
          };
        }
        if (ts <= Date.now()) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "gtd_timestamp must be a future datetime.",
                  code: "VALIDATION_ERROR",
                }),
              },
            ],
            isError: true,
          };
        }
      }

      let limitType = "gtc";
      if (ioc) limitType = "ioc";
      else if (fok) limitType = "fok";
      else if (post_only) limitType = "post_only";
      else if (gtd_timestamp !== undefined) limitType = "gtd";

      const limitObj: Record<string, unknown> = { price: limit_price, type: limitType };
      if (gtd_timestamp !== undefined) limitObj.expiration = gtd_timestamp;
      payload.limit = limitObj;
    }

    if (hasStopPrice && hasStopType) {
      payload.stop = { price: stop_price, type: stop_type };
    }

    const data = await client.post<OrderResponse>(
      `/markets/${market_id.toLowerCase()}/orders`,
      payload,
    );

    const result = {
      content: [{ type: "text" as const, text: JSON.stringify(data.order, null, 2) }],
    };
    logAudit({
      ts: new Date().toISOString(),
      tool: "place_order",
      transport,
      args_summary: { market_id, type, price_type, amount },
      success: true,
    });
    return result;
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    const result = {
      content: [{ type: "text" as const, text: JSON.stringify(msg) }],
      isError: true,
    };
    logAudit({
      ts: new Date().toISOString(),
      tool: "place_order",
      transport,
      args_summary: { market_id, type, price_type, amount },
      success: false,
      error_code: msg.code,
    });
    return result;
  }
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
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
      ioc: z
        .boolean()
        .optional()
        .describe("Immediate-or-cancel: fill as much as possible, cancel the rest. Mutually exclusive with fok, post_only, gtd_timestamp."),
      fok: z
        .boolean()
        .optional()
        .describe("Fill-or-kill: fill the entire order or cancel it entirely. Mutually exclusive with ioc, post_only, gtd_timestamp."),
      post_only: z
        .boolean()
        .optional()
        .describe("Post-only: rejected if it would execute immediately as a taker. Mutually exclusive with ioc, fok, gtd_timestamp."),
      gtd_timestamp: z
        .string()
        .optional()
        .describe("Good-till-date: ISO 8601 datetime after which the order is canceled. Mutually exclusive with ioc, fok, post_only."),
      stop_price: z
        .number()
        .positive()
        .optional()
        .describe("Stop trigger price. Must be paired with stop_type."),
      stop_type: z
        .enum([">=", "<="])
        .optional()
        .describe("Stop trigger direction: '>=' triggers when price rises to stop_price, '<=' when it falls. Must be paired with stop_price."),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute the order. " +
            "Any other value will reject the request without placing an order.",
        ),
    },
    (args) => handlePlaceOrder(args, client),
  );
}
