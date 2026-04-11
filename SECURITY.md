# Security Policy

## Supported Versions

Only the latest published version on npm receives security fixes.
Older versions are not patched; users should upgrade to the current release.

| Version | Supported |
|---------|-----------|
| Latest (1.x) | Yes |
| Older | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report them privately via [GitHub Security Advisories](https://github.com/gtorreal/buda-mcp/security/advisories/new).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (even a rough one helps)
- Any suggested mitigation if you have one

You can expect:
- Acknowledgement within **48 hours**
- A status update within **7 days** (confirmed, needs more info, or not a vulnerability)
- Coordinated disclosure — a fix will be released before the vulnerability is made public
- Credit in the changelog if you would like it

## Scope

The following are considered **in scope**:

- Authentication bypass or token leakage in the HTTP server
- Input validation bypasses that reach the Buda API with unintended data
- Information disclosure of credentials, API keys, or account data to unauthorized callers
- Dependency vulnerabilities in runtime dependencies (`express`, `helmet`, `express-rate-limit`, `@modelcontextprotocol/sdk`) that are exploitable in this server's context

The following are considered **out of scope**:

- **Prompt injection via API response content** — the server returns data from the Buda.com API verbatim as JSON. An AI agent interpreting that data in unexpected ways is a risk at the agent/model layer, not in this server. There is no server-side mitigation for this class of issue.
- **`confirmation_token='CONFIRM'` bypass** — this token is a UX safety guard to prevent accidental execution by AI agents, not a cryptographic access control. Any caller who holds a valid `MCP_AUTH_TOKEN` already has full account access by design.
- Vulnerabilities in Buda.com's own API or infrastructure
- Social engineering or phishing attacks
- Bugs in MCP client applications (Claude Desktop, Cursor, etc.)

## Security Model

**stdio mode (recommended for personal use):** The server process runs locally on your machine. Credentials are set as environment variables and never leave your system. There is no network exposure.

**HTTP mode (self-hosted):** The server exposes an HTTP endpoint protected by a bearer token (`MCP_AUTH_TOKEN`). This mode **requires TLS termination** (via Railway, Nginx, Caddy, etc.) when auth credentials are configured. Running over plain HTTP exposes your API key and secret to network interception.

The `MCP_AUTH_TOKEN` is the sole cryptographic boundary for the HTTP server. Anyone who holds a valid token has full access to all tools the server exposes, including fund movements. Treat it with the same care as your Buda API secret.
