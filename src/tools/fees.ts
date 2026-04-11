import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { validateCurrency } from "../validation.js";
import { flattenAmount } from "../utils.js";
import type { FeesResponse } from "../types.js";

export const toolSchema = {
  name: "get_network_fees",
  description:
    "Returns the deposit or withdrawal network fee schedule for a currency on Buda.com. " +
    "Useful before initiating a transfer to preview costs. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'What are the withdrawal fees for BTC?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'BTC', 'ETH', 'CLP').",
      },
      type: {
        type: "string",
        description: "Fee direction: 'deposit' or 'withdrawal'.",
      },
    },
    required: ["currency", "type"],
  },
};

type GetNetworkFeesArgs = { currency: string; type: "deposit" | "withdrawal" };

export async function handleGetNetworkFees(
  args: GetNetworkFeesArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency, type } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const data = await client.get<FeesResponse>(`/currencies/${currency.toUpperCase()}/fees/${type}`);

    const fees = data.fees.map((f) => {
      const baseFee = flattenAmount(f.base_fee);
      return {
        name: f.name,
        fee_type: f.fee_type,
        base_fee: baseFee.value,
        base_fee_currency: baseFee.currency,
        percent: f.percent !== null ? parseFloat(f.percent) : null,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ currency: currency.toUpperCase(), type, fees }, null, 2),
        },
      ],
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
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'BTC', 'ETH', 'CLP')."),
      type: z.enum(["deposit", "withdrawal"]).describe("Fee direction: 'deposit' or 'withdrawal'."),
    },
    (args) => handleGetNetworkFees(args, client),
  );
}
