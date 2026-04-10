import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import type { OrderResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "cancel_order",
    "Cancel an open order by ID on Buda.com. " +
      "IMPORTANT: To prevent accidental cancellation from ambiguous prompts, you must pass " +
      "confirmation_token='CONFIRM' to execute. " +
      "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
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
    async ({ order_id, confirmation_token }) => {
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
          state: "canceling",
        });

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
