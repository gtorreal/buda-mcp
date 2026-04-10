import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient, BudaApiError } from "../client.js";
import type { BalancesResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    "get_balances",
    "Get all currency balances for the authenticated Buda.com account. " +
      "Returns total, available, frozen, and pending withdrawal amounts per currency. " +
      "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
    {},
    async () => {
      try {
        const data = await client.get<BalancesResponse>("/balances");
        return {
          content: [{ type: "text", text: JSON.stringify(data.balances, null, 2) }],
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
    },
  );
}
