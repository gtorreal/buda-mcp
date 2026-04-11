import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateCurrency } from "../validation.js";
import type { BanksResponse } from "../types.js";

export const toolSchema = {
  name: "get_available_banks",
  description:
    "Returns banks available for deposits and withdrawals of a fiat currency on Buda.com. " +
    "Returns an empty banks array (not an error) if the currency has no associated banks " +
    "(e.g. crypto currencies or unsupported fiat currencies). " +
    "Results are cached for 60 seconds. " +
    "Example: 'Which banks can I use for CLP deposits?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Currency code (e.g. 'CLP', 'COP', 'PEN').",
      },
    },
    required: ["currency"],
  },
};

export async function handleGetAvailableBanks(
  args: { currency: string },
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { currency } = args;

  const validationError = validateCurrency(currency);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  const currencyUpper = currency.toUpperCase();

  try {
    const data = await cache.getOrFetch<BanksResponse>(
      `banks:${currencyUpper}`,
      CACHE_TTL.BANKS,
      () => client.get<BanksResponse>(`/currencies/${currencyUpper}/banks`),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              currency: currencyUpper,
              banks: data.banks.map((b) => ({ id: b.id, name: b.name, country: b.country ?? null })),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    // 404 means no banks exist for this currency — return empty list (not an error)
    if (err instanceof BudaApiError && err.status === 404) {
      return {
        content: [{ type: "text", text: JSON.stringify({ currency: currencyUpper, banks: [] }, null, 2) }],
      };
    }
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

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      currency: z.string().min(2).max(10).describe("Currency code (e.g. 'CLP', 'COP', 'PEN')."),
    },
    (args) => handleGetAvailableBanks(args, client, cache),
  );
}
