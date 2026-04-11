import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { SingleBalanceResponse } from "../types.js";

export const toolSchema = {
  name: "get_balance",
  description:
    "Returns the balance for a single currency for the authenticated Buda.com account. " +
    "Fetches total, available, frozen, and pending-withdrawal amounts as floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'How much ETH do I have available?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'CLP', 'USDC').",
      },
    },
    required: ["currency"],
  },
};

type GetBalanceArgs = { currency: string };

export async function handleGetBalance(
  args: GetBalanceArgs,
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
    const data = await client.get<SingleBalanceResponse>(`/balances/${currency.toUpperCase()}`);
    const b = data.balance;
    const amount = flattenAmount(b.amount);
    const available = flattenAmount(b.available_amount);
    const frozen = flattenAmount(b.frozen_amount);
    const pending = flattenAmount(b.pending_withdraw_amount);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: b.id,
              amount: amount.value,
              amount_currency: amount.currency,
              available_amount: available.value,
              available_amount_currency: available.currency,
              frozen_amount: frozen.value,
              frozen_amount_currency: frozen.currency,
              pending_withdraw_amount: pending.value,
              pending_withdraw_amount_currency: pending.currency,
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
    toolSchema.name,
    toolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'CLP', 'USDC')."),
    },
    (args) => handleGetBalance(args, client),
  );
}
