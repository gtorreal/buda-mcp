import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { logAudit } from "../audit.js";
import type { OrderResponse } from "../types.js";

export const toolSchema = {
  name: "cancel_order",
  description:
    "Cancel an open order by ID on Buda.com. " +
    "IMPORTANT: To prevent accidental cancellation from ambiguous prompts, you must pass " +
    "confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
  inputSchema: {
    type: "object" as const,
    properties: {
      order_id: {
        type: "number",
        description: "The numeric ID of the order to cancel.",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to cancel the order. " +
          "Any other value will reject the request without canceling.",
      },
    },
    required: ["order_id", "confirmation_token"],
  },
};

type CancelOrderArgs = {
  order_id: number;
  confirmation_token: string;
};

export async function handleCancelOrder(
  args: CancelOrderArgs,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { order_id, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Order not canceled. confirmation_token must equal 'CONFIRM' to execute. " +
              "Verify the order ID and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            order_id,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const data = await client.put<OrderResponse>(`/orders/${order_id}`, {
      order: { state: "canceling" },
    });

    const result = { content: [{ type: "text" as const, text: JSON.stringify(data.order, null, 2) }] };
    logAudit({ ts: new Date().toISOString(), tool: "cancel_order", transport, args_summary: { order_id }, success: true });
    return result;
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    const result = { content: [{ type: "text" as const, text: JSON.stringify(msg) }], isError: true as const };
    logAudit({ ts: new Date().toISOString(), tool: "cancel_order", transport, args_summary: { order_id }, success: false, error_code: msg.code });
    return result;
  }
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
      order_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the order to cancel."),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to cancel the order. " +
            "Any other value will reject the request without canceling.",
        ),
    },
    (args) => handleCancelOrder(args, client, transport),
  );
}
