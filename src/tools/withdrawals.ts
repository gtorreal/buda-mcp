import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { WithdrawalsResponse, Withdrawal } from "../types.js";

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
}
