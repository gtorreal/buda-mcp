import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import type { RemittancesResponse, SingleRemittanceResponse, Remittance } from "../types.js";

export const listRemittancesToolSchema = {
  name: "list_remittances",
  description:
    "Returns all fiat remittance transfers for the authenticated Buda.com account. " +
    "Supports pagination. All amounts are floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'List my recent remittances.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      per: {
        type: "number",
        description: "Results per page (default: 20, max: 300).",
      },
      page: {
        type: "number",
        description: "Page number (default: 1).",
      },
    },
  },
};

export const getRemittanceToolSchema = {
  name: "get_remittance",
  description:
    "Returns a single remittance by its ID on Buda.com. " +
    "Fetches current state and details. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'What is the status of remittance 77?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "The numeric ID of the remittance.",
      },
    },
    required: ["id"],
  },
};

function normalizeRemittance(r: Remittance) {
  const amount = flattenAmount(r.amount);
  return {
    id: r.id,
    state: r.state,
    currency: r.currency,
    amount: amount.value,
    amount_currency: amount.currency,
    recipient_id: r.recipient_id,
    created_at: r.created_at,
    expires_at: r.expires_at ?? null,
  };
}

export async function handleListRemittances(
  args: { per?: number; page?: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const params: Record<string, string | number> = {};
    if (args.per !== undefined) params.per = args.per;
    if (args.page !== undefined) params.page = args.page;

    const data = await client.get<RemittancesResponse>(
      "/remittances",
      Object.keys(params).length > 0 ? params : undefined,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              remittances: data.remittances.map(normalizeRemittance),
              meta: data.meta,
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
        ? { error: err.message, code: err.status, path: err.path }
        : { error: String(err), code: "UNKNOWN" };
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export async function handleGetRemittance(
  args: { id: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await client.get<SingleRemittanceResponse>(`/remittances/${args.id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(normalizeRemittance(data.remittance), null, 2) }],
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
    listRemittancesToolSchema.name,
    listRemittancesToolSchema.description,
    {
      per: z.number().int().min(1).max(300).optional().describe("Results per page (default: 20, max: 300)."),
      page: z.number().int().min(1).optional().describe("Page number (default: 1)."),
    },
    (args) => handleListRemittances(args, client),
  );

  server.tool(
    getRemittanceToolSchema.name,
    getRemittanceToolSchema.description,
    {
      id: z.number().int().positive().describe("The numeric ID of the remittance."),
    },
    (args) => handleGetRemittance(args, client),
  );
}
