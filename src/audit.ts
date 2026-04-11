/**
 * Structured audit logging for destructive MCP tool calls.
 *
 * Writes newline-delimited JSON to stderr so it never pollutes the stdio MCP transport
 * and is captured by Railway / any log aggregator attached to the process.
 *
 * Rules for args_summary:
 *   - Include: market_id, currency, price_type, type, amount ranges
 *   - NEVER include: confirmation_token, invoice, address, bank_account_id
 */

export interface AuditEvent {
  ts: string;
  tool: string;
  transport: "http" | "stdio";
  ip?: string;
  args_summary: Record<string, unknown>;
  success: boolean;
  error_code?: string | number;
}

export function logAudit(event: AuditEvent): void {
  process.stderr.write(JSON.stringify({ audit: true, ...event }) + "\n");
}
