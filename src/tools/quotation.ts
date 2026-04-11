import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { QuotationResponse } from "../types.js";

export const toolSchema = {
  name: "get_real_quotation",
  description:
    "Gets a server-side price quotation for a buy or sell on Buda.com. " +
    "Calls the Buda quotation API to compute an accurate fill estimate including fees, " +
    "based on live order book state. Prefer this over simulate_order for accurate fee-tier-aware quotes. " +
    "This is a POST (not idempotent) but does not place an order. Public endpoint — no API key required. " +
    "Parameters: market_id, type ('Bid'|'Ask'), amount, optional limit price. " +
    "Example: 'Get an accurate quote to sell 0.05 BTC on BTC-CLP.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      type: {
        type: "string",
        description: "'Bid' to buy base currency, 'Ask' to sell base currency.",
      },
      amount: {
        type: "number",
        description: "Order size (positive number).",
      },
      limit: {
        type: "number",
        description: "Optional limit price in quote currency.",
      },
    },
    required: ["market_id", "type", "amount"],
  },
};

type GetRealQuotationArgs = {
  market_id: string;
  type: "Bid" | "Ask";
  amount: number;
  limit?: number;
};

export async function handleGetRealQuotation(
  args: GetRealQuotationArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { market_id, type, amount, limit } = args;

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  const id = market_id.toLowerCase();
  const payload: Record<string, unknown> = { type, amount: String(amount) };
  if (limit !== undefined) payload.limit = String(limit);

  try {
    const data = await client.post<QuotationResponse>(`/markets/${id}/quotations`, {
      quotation: payload,
    });

    const q = data.quotation;
    const flatAmount = flattenAmount(q.amount);
    const flatLimit = q.limit ? flattenAmount(q.limit) : null;
    const flatBase = flattenAmount(q.base_balance_change);
    const flatQuote = flattenAmount(q.quote_balance_change);
    const flatFee = flattenAmount(q.fee_amount);
    const flatOrder = flattenAmount(q.order_amount);

    const result = {
      id: q.id ?? null,
      type: q.type,
      market_id: q.market_id,
      amount: flatAmount.value,
      amount_currency: flatAmount.currency,
      limit: flatLimit ? flatLimit.value : null,
      limit_currency: flatLimit ? flatLimit.currency : null,
      base_balance_change: flatBase.value,
      base_balance_change_currency: flatBase.currency,
      quote_balance_change: flatQuote.value,
      quote_balance_change_currency: flatQuote.currency,
      fee_amount: flatFee.value,
      fee_currency: flatFee.currency,
      order_amount: flatOrder.value,
      order_amount_currency: flatOrder.currency,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = formatApiError(err);
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
      market_id: z.string().describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      type: z.enum(["Bid", "Ask"]).describe("'Bid' to buy base currency, 'Ask' to sell base currency."),
      amount: z.number().positive().describe("Order size (positive number)."),
      limit: z.number().positive().optional().describe("Optional limit price in quote currency."),
    },
    (args) => handleGetRealQuotation(args, client),
  );
}
