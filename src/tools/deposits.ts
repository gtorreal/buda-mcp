import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { DepositsResponse, Deposit } from "../types.js";

export const getDepositHistoryToolSchema = {
  name: "get_deposit_history",
  description:
    "Returns deposit history for a currency on the authenticated Buda.com account. " +
    "Supports state filtering and pagination. All amounts are floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'Show my last 10 BTC deposits.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'CLP').",
      },
      state: {
        type: "string",
        description: "Filter by state: 'pending_info', 'pending', 'confirmed', 'anulled', 'retained'.",
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

type GetDepositHistoryArgs = {
  currency: string;
  state?: "pending_info" | "pending" | "confirmed" | "anulled" | "retained";
  per?: number;
  page?: number;
};

function normalizeDeposit(d: Deposit) {
  const amount = flattenAmount(d.amount);
  const fee = flattenAmount(d.fee);
  return {
    id: d.id,
    state: d.state,
    currency: d.currency,
    amount: amount.value,
    amount_currency: amount.currency,
    fee: fee.value,
    fee_currency: fee.currency,
    created_at: d.created_at,
    updated_at: d.updated_at,
    transfer_account_id: d.transfer_account_id,
    transaction_hash: d.transaction_hash,
  };
}

export async function handleGetDepositHistory(
  args: GetDepositHistoryArgs,
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

    const data = await client.get<DepositsResponse>(
      `/currencies/${currency.toUpperCase()}/deposits`,
      Object.keys(params).length > 0 ? params : undefined,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              deposits: data.deposits.map(normalizeDeposit),
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
    getDepositHistoryToolSchema.name,
    getDepositHistoryToolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'CLP')."),
      state: z
        .enum(["pending_info", "pending", "confirmed", "anulled", "retained"])
        .optional()
        .describe("Filter by state."),
      per: z.number().int().min(1).max(300).optional().describe("Results per page (default: 20, max: 300)."),
      page: z.number().int().min(1).optional().describe("Page number (default: 1)."),
    },
    (args) => handleGetDepositHistory(args, client),
  );
}
