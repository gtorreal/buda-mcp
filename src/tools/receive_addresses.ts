import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { logAudit } from "../audit.js";
import type { ReceiveAddressesResponse, SingleReceiveAddressResponse, ReceiveAddress } from "../types.js";

export const createReceiveAddressToolSchema = {
  name: "create_receive_address",
  description:
    "Generates a new receive address for a crypto currency. " +
    "Creates a new blockchain deposit address for the given currency. " +
    "Each call generates a distinct address. Not idempotent. " +
    "IMPORTANT: Pass confirmation_token='CONFIRM' to execute. " +
    "Only applicable to crypto currencies (BTC, ETH, etc.). " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Give me a fresh Bitcoin deposit address.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'ETH').",
      },
      confirmation_token: {
        type: "string",
        description: "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to generate a new address.",
      },
    },
    required: ["currency", "confirmation_token"],
  },
};

export const listReceiveAddressesToolSchema = {
  name: "list_receive_addresses",
  description:
    "Lists all receive (deposit) addresses for a crypto currency on the authenticated Buda.com account. " +
    "Returns an empty array if no addresses have been created yet. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'What are my Bitcoin deposit addresses?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'ETH').",
      },
    },
    required: ["currency"],
  },
};

export const getReceiveAddressToolSchema = {
  name: "get_receive_address",
  description:
    "Returns a single receive address by its ID for a given currency on Buda.com. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Get the details of my BTC receive address ID 42.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'ETH').",
      },
      id: {
        type: "number",
        description: "The numeric ID of the receive address.",
      },
    },
    required: ["currency", "id"],
  },
};

function normalizeAddress(a: ReceiveAddress) {
  return {
    id: a.id,
    address: a.address,
    currency: a.currency,
    created_at: a.created_at,
    label: a.label ?? null,
  };
}

export async function handleListReceiveAddresses(
  args: { currency: string },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const data = await client.get<ReceiveAddressesResponse>(
      `/currencies/${currency.toUpperCase()}/receive_addresses`,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { receive_addresses: data.receive_addresses.map(normalizeAddress) },
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

export async function handleGetReceiveAddress(
  args: { currency: string; id: number },
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, id } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const data = await client.get<SingleReceiveAddressResponse>(
      `/currencies/${currency.toUpperCase()}/receive_addresses/${id}`,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(normalizeAddress(data.receive_address), null, 2) }],
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

export async function handleCreateReceiveAddress(
  args: { currency: string; confirmation_token: string },
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Address not generated. confirmation_token must equal 'CONFIRM' to execute. " +
              "Each call creates a distinct address — review and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            preview: { currency },
          }),
        },
      ],
      isError: true,
    };
  }

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const data = await client.post<SingleReceiveAddressResponse>(
      `/currencies/${currency.toUpperCase()}/receive_addresses`,
      {},
    );
    const result = { content: [{ type: "text" as const, text: JSON.stringify(normalizeAddress(data.receive_address), null, 2) }] };
    logAudit({ ts: new Date().toISOString(), tool: "create_receive_address", transport, args_summary: { currency }, success: true });
    return result;
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    const result = { content: [{ type: "text" as const, text: JSON.stringify(msg) }], isError: true as const };
    logAudit({ ts: new Date().toISOString(), tool: "create_receive_address", transport, args_summary: { currency }, success: false, error_code: msg.code });
    return result;
  }
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    listReceiveAddressesToolSchema.name,
    listReceiveAddressesToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'ETH')."),
    },
    (args) => handleListReceiveAddresses(args, client),
  );

  server.tool(
    getReceiveAddressToolSchema.name,
    getReceiveAddressToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'ETH')."),
      id: z.number().int().positive().describe("The numeric ID of the receive address."),
    },
    (args) => handleGetReceiveAddress(args, client),
  );

  server.tool(
    createReceiveAddressToolSchema.name,
    createReceiveAddressToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'ETH')."),
      confirmation_token: z
        .string()
        .describe("Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to generate a new address."),
    },
    (args) => handleCreateReceiveAddress(args, client),
  );
}
