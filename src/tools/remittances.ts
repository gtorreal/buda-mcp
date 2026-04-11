import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import { validateCurrency } from "../validation.js";
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

export const quoteRemittanceToolSchema = {
  name: "quote_remittance",
  description:
    "Creates a time-limited remittance quote without committing funds. " +
    "Requests a price quote for a fiat remittance to a saved recipient. " +
    "Returns a remittance object in 'quoted' state with an expiry timestamp. " +
    "NOT idempotent — creates a new remittance record each call. " +
    "To execute, call accept_remittance_quote with the returned ID before it expires. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Get a remittance quote to send 100000 CLP to recipient 5.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Fiat currency code (e.g. 'CLP', 'COP').",
      },
      amount: {
        type: "number",
        description: "Amount to remit (positive number).",
      },
      recipient_id: {
        type: "number",
        description: "ID of the saved remittance recipient.",
      },
    },
    required: ["currency", "amount", "recipient_id"],
  },
};

export const acceptRemittanceQuoteToolSchema = {
  name: "accept_remittance_quote",
  description:
    "Accepts and executes a pending remittance quote. " +
    "Commits a previously quoted remittance, triggering a real fiat transfer. " +
    "IRREVERSIBLE once the transfer is initiated. " +
    "You must pass confirmation_token='CONFIRM' to proceed. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: \"Accept remittance quote 77 — set confirmation_token='CONFIRM'.\"",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "The numeric ID of the remittance quote to accept.",
      },
      confirmation_token: {
        type: "string",
        description: "Must be 'CONFIRM' to proceed. Any other value aborts.",
      },
    },
    required: ["id", "confirmation_token"],
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

export async function handleQuoteRemittance(
  args: { currency: string; amount: number; recipient_id: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, amount, recipient_id } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const data = await client.post<SingleRemittanceResponse>("/remittances", {
      remittance: {
        currency: currency.toUpperCase(),
        amount: String(amount),
        recipient_id,
      },
    });
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

export async function handleAcceptRemittanceQuote(
  args: { id: number; confirmation_token: string },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { id, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Accepting a remittance quote is irreversible. Pass confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            remittance_id: id,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const data = await client.put<SingleRemittanceResponse>(`/remittances/${id}`, {
      remittance: { state: "confirming" },
    });
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

  server.tool(
    quoteRemittanceToolSchema.name,
    quoteRemittanceToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Fiat currency code (e.g. 'CLP', 'COP')."),
      amount: z.number().positive().describe("Amount to remit (positive number)."),
      recipient_id: z.number().int().positive().describe("ID of the saved remittance recipient."),
    },
    (args) => handleQuoteRemittance(args, client),
  );

  server.tool(
    acceptRemittanceQuoteToolSchema.name,
    acceptRemittanceQuoteToolSchema.description,
    {
      id: z.number().int().positive().describe("The numeric ID of the remittance quote to accept."),
      confirmation_token: z.string().describe("Must be 'CONFIRM' to proceed. Any other value aborts."),
    },
    (args) => handleAcceptRemittanceQuote(args, client),
  );
}
