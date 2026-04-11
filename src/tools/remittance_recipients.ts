import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import type { RemittanceRecipientsResponse, SingleRemittanceRecipientResponse, RemittanceRecipient } from "../types.js";

export const listToolSchema = {
  name: "list_remittance_recipients",
  description:
    "Lists all saved remittance recipients (bank accounts) for the authenticated Buda.com account. " +
    "Supports pagination. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Who are my saved remittance recipients?'",
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

export const getToolSchema = {
  name: "get_remittance_recipient",
  description:
    "Returns a single saved remittance recipient by its ID on Buda.com. " +
    "Fetches saved bank details for one recipient. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Show remittance recipient ID 5.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "The numeric ID of the remittance recipient.",
      },
    },
    required: ["id"],
  },
};

function normalizeRecipient(r: RemittanceRecipient) {
  return {
    id: r.id,
    name: r.name,
    bank: r.bank,
    account_number: r.account_number,
    currency: r.currency,
    country: r.country ?? null,
  };
}

export async function handleListRemittanceRecipients(
  args: { per?: number; page?: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const params: Record<string, string | number> = {};
    if (args.per !== undefined) params.per = args.per;
    if (args.page !== undefined) params.page = args.page;

    const data = await client.get<RemittanceRecipientsResponse>(
      "/remittance_recipients",
      Object.keys(params).length > 0 ? params : undefined,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              remittance_recipients: data.remittance_recipients.map(normalizeRecipient),
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

export async function handleGetRemittanceRecipient(
  args: { id: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await client.get<SingleRemittanceRecipientResponse>(`/remittance_recipients/${args.id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(normalizeRecipient(data.remittance_recipient), null, 2) }],
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
    listToolSchema.name,
    listToolSchema.description,
    {
      per: z.number().int().min(1).max(300).optional().describe("Results per page (default: 20, max: 300)."),
      page: z.number().int().min(1).optional().describe("Page number (default: 1)."),
    },
    (args) => handleListRemittanceRecipients(args, client),
  );

  server.tool(
    getToolSchema.name,
    getToolSchema.description,
    {
      id: z.number().int().positive().describe("The numeric ID of the remittance recipient."),
    },
    (args) => handleGetRemittanceRecipient(args, client),
  );
}
