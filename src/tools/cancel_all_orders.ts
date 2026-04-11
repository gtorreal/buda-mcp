import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import type { CancelAllOrdersResponse } from "../types.js";

export const toolSchema = {
  name: "cancel_all_orders",
  description:
    "Cancel all open orders on Buda.com, optionally filtered by a specific market. " +
    "Pass market_id='*' to cancel across all markets, or a specific market ID (e.g. 'BTC-CLP'). " +
    "IMPORTANT: This action is irreversible. Pass confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP') or '*' to cancel orders across all markets.",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
          "Any other value will reject the request without canceling.",
      },
    },
    required: ["market_id", "confirmation_token"],
  },
};

type CancelAllOrdersArgs = {
  market_id: string;
  confirmation_token: string;
};

export async function handleCancelAllOrders(
  args: CancelAllOrdersArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { market_id, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Orders not canceled. confirmation_token must equal 'CONFIRM' to execute. " +
              "Review and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            preview: { market_id },
          }),
        },
      ],
      isError: true,
    };
  }

  if (market_id !== "*") {
    const validationError = validateMarketId(market_id);
    if (validationError) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) },
        ],
        isError: true,
      };
    }
  }

  try {
    const params =
      market_id !== "*" ? { market_id: market_id.toLowerCase() } : undefined;

    const data = await client.delete<CancelAllOrdersResponse>(`/orders`, params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ canceled_count: data.canceled_count, market_id }),
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
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .min(1)
        .describe("Market ID (e.g. 'BTC-CLP') or '*' to cancel orders across all markets."),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
            "Any other value will reject the request without canceling.",
        ),
    },
    (args) => handleCancelAllOrders(args, client),
  );
}
