import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import type { BalancesResponse } from "../types.js";

export const toolSchema = {
  name: "get_balances",
  description:
    "Returns all currency balances for the authenticated Buda.com account as flat typed objects. " +
    "Each currency entry includes total amount, available amount (not frozen), frozen amount, and " +
    "pending withdrawal amount — all as floats with separate _currency fields. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET. " +
    "Example: 'How much BTC do I have available to trade right now?'",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {},
    async () => {
      try {
        const data = await client.get<BalancesResponse>("/balances");

        const result = data.balances.map((b) => {
          const amount = flattenAmount(b.amount);
          const available = flattenAmount(b.available_amount);
          const frozen = flattenAmount(b.frozen_amount);
          const pending = flattenAmount(b.pending_withdraw_amount);

          return {
            id: b.id,
            amount: amount.value,
            amount_currency: amount.currency,
            available_amount: available.value,
            available_amount_currency: available.currency,
            frozen_amount: frozen.value,
            frozen_amount_currency: frozen.currency,
            pending_withdraw_amount: pending.value,
            pending_withdraw_amount_currency: pending.currency,
          };
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    },
  );
}
