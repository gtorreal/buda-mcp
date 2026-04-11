import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import type { MeResponse } from "../types.js";

export const toolSchema = {
  name: "get_account_info",
  description:
    "Returns the authenticated user's profile on Buda.com. " +
    "Fetches account details including email, display name, pubsub key, and monthly transacted amounts. " +
    "Read-only; no side effects. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'What is my account email and how much have I transacted this month?'",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetAccountInfo(
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await client.get<MeResponse>("/me");
    const me = data.me;
    const monthly = flattenAmount(me.monthly_transacted);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: me.id,
              email: me.email,
              name: me.name ?? null,
              monthly_transacted: monthly.value,
              monthly_transacted_currency: monthly.currency,
              pubsub_key: me.pubsub_key ?? null,
            },
            null,
            2,
          ),
        },
      ],
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
    toolSchema.name,
    toolSchema.description,
    {},
    () => handleGetAccountInfo(client),
  );
}
