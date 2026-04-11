import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { WithdrawalsResponse, SingleWithdrawalResponse, Withdrawal } from "../types.js";

export const getWithdrawalHistoryToolSchema = {
  name: "get_withdrawal_history",
  description:
    "Returns withdrawal history for a currency on the authenticated Buda.com account. " +
    "Supports state filtering and pagination. All amounts are floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Show my pending CLP withdrawals.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'CLP').",
      },
      state: {
        type: "string",
        description:
          "Filter by state: 'pending_signature', 'pending', 'confirmed', 'rejected', 'anulled'.",
      },
      per: {
        type: "number",
        description: "Results per page (default: 20, max: 300).",
      },
      page: {
        type: "number",
        description: "Page number (default: 1).",
      },
    },
    required: ["currency"],
  },
};

type GetWithdrawalHistoryArgs = {
  currency: string;
  state?: "pending_signature" | "pending" | "confirmed" | "rejected" | "anulled";
  per?: number;
  page?: number;
};

function normalizeWithdrawal(w: Withdrawal) {
  const amount = flattenAmount(w.amount);
  const fee = flattenAmount(w.fee);
  return {
    id: w.id,
    state: w.state,
    currency: w.currency,
    amount: amount.value,
    amount_currency: amount.currency,
    fee: fee.value,
    fee_currency: fee.currency,
    address: w.address,
    tx_hash: w.tx_hash,
    bank_account_id: w.bank_account_id,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

export async function handleGetWithdrawalHistory(
  args: GetWithdrawalHistoryArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, state, per, page } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const params: Record<string, string | number> = {};
    if (state) params.state = state;
    if (per !== undefined) params.per = per;
    if (page !== undefined) params.page = page;

    const data = await client.get<WithdrawalsResponse>(
      `/currencies/${currency.toUpperCase()}/withdrawals`,
      Object.keys(params).length > 0 ? params : undefined,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              withdrawals: data.withdrawals.map(normalizeWithdrawal),
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

export const createWithdrawalToolSchema = {
  name: "create_withdrawal",
  description:
    "Create a withdrawal on Buda.com. Supports both crypto (address) and fiat (bank_account_id) withdrawals. " +
    "Exactly one of address or bank_account_id must be provided. " +
    "IMPORTANT: Pass confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: { type: "string", description: "Currency code (e.g. 'BTC', 'CLP')." },
      amount: { type: "number", description: "Withdrawal amount." },
      address: { type: "string", description: "Destination crypto address. Mutually exclusive with bank_account_id." },
      network: { type: "string", description: "Blockchain network for crypto withdrawals (e.g. 'bitcoin', 'ethereum')." },
      bank_account_id: { type: "number", description: "Fiat bank account ID. Mutually exclusive with address." },
      confirmation_token: {
        type: "string",
        description: "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute.",
      },
    },
    required: ["currency", "amount", "confirmation_token"],
  },
};

type CreateWithdrawalArgs = {
  currency: string;
  amount: number;
  address?: string;
  network?: string;
  bank_account_id?: number;
  confirmation_token: string;
};

export async function handleCreateWithdrawal(
  args: CreateWithdrawalArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, amount, address, network, bank_account_id, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Withdrawal not created. confirmation_token must equal 'CONFIRM' to execute. " +
              "Review the details and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            preview: { currency, amount, destination: address ?? bank_account_id },
          }),
        },
      ],
      isError: true,
    };
  }

  const hasAddress = address !== undefined;
  const hasBankAccount = bank_account_id !== undefined;

  if (hasAddress && hasBankAccount) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Provide either address (crypto) or bank_account_id (fiat), not both.",
            code: "VALIDATION_ERROR",
          }),
        },
      ],
      isError: true,
    };
  }

  if (!hasAddress && !hasBankAccount) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Either address (crypto) or bank_account_id (fiat) must be provided.",
            code: "VALIDATION_ERROR",
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
    const payload: Record<string, unknown> = { amount: String(amount) };
    if (hasAddress) {
      payload.address = address;
      if (network) payload.network = network;
    } else {
      payload.bank_account_id = bank_account_id;
    }

    const data = await client.post<SingleWithdrawalResponse>(
      `/currencies/${currency.toUpperCase()}/withdrawals`,
      payload,
    );

    return {
      content: [{ type: "text", text: JSON.stringify(normalizeWithdrawal(data.withdrawal), null, 2) }],
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
    getWithdrawalHistoryToolSchema.name,
    getWithdrawalHistoryToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'CLP')."),
      state: z
        .enum(["pending_signature", "pending", "confirmed", "rejected", "anulled"])
        .optional()
        .describe("Filter by state."),
      per: z.number().int().min(1).max(300).optional().describe("Results per page (default: 20, max: 300)."),
      page: z.number().int().min(1).optional().describe("Page number (default: 1)."),
    },
    (args) => handleGetWithdrawalHistory(args, client),
  );

  server.tool(
    createWithdrawalToolSchema.name,
    createWithdrawalToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'CLP')."),
      amount: z.number().positive().describe("Withdrawal amount."),
      address: z.string().optional().describe("Destination crypto address. Mutually exclusive with bank_account_id."),
      network: z.string().optional().describe("Blockchain network for crypto withdrawals (e.g. 'bitcoin', 'ethereum')."),
      bank_account_id: z.number().int().positive().optional().describe("Fiat bank account ID. Mutually exclusive with address."),
      confirmation_token: z
        .string()
        .describe("Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute."),
    },
    (args) => handleCreateWithdrawal(args, client),
  );
}
