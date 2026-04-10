import { createHmac } from "crypto";

const BASE_URL = "https://www.buda.com/api/v2";

export class BudaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "BudaApiError";
  }
}

export class BudaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;

  constructor(
    baseUrl: string = BASE_URL,
    apiKey?: string,
    apiSecret?: string,
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  hasAuth(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  private nonce(): string {
    return String(Math.floor(Date.now() * 1000));
  }

  private sign(method: string, pathWithQuery: string, body: string, nonce: string): string {
    const encodedBody = body ? Buffer.from(body).toString("base64") : "";
    const parts = [method, pathWithQuery];
    if (encodedBody) parts.push(encodedBody);
    parts.push(nonce);
    const msg = parts.join(" ");
    return createHmac("sha384", this.apiSecret!).update(msg).digest("hex");
  }

  private authHeaders(method: string, path: string, body?: string): Record<string, string> {
    if (!this.hasAuth()) return {};
    const nonce = this.nonce();
    const signature = this.sign(method, path, body ?? "", nonce);
    return {
      "X-SBTC-APIKEY": this.apiKey!,
      "X-SBTC-NONCE": nonce,
      "X-SBTC-SIGNATURE": signature,
    };
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "buda-mcp/1.1.1",
      ...this.authHeaders("GET", urlPath),
    };

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // ignore parse error, use statusText
      }
      throw new BudaApiError(response.status, path, `Buda API ${response.status}: ${detail}`);
    }

    return response.json() as Promise<T>;
  }

  async post<T>(path: string, payload: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);
    const bodyStr = JSON.stringify(payload);
    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "buda-mcp/1.1.1",
      ...this.authHeaders("POST", urlPath, bodyStr),
    };

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: bodyStr,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // ignore parse error, use statusText
      }
      throw new BudaApiError(response.status, path, `Buda API ${response.status}: ${detail}`);
    }

    return response.json() as Promise<T>;
  }

  async put<T>(path: string, payload: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);
    const bodyStr = JSON.stringify(payload);
    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "buda-mcp/1.1.1",
      ...this.authHeaders("PUT", urlPath, bodyStr),
    };

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers,
      body: bodyStr,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // ignore parse error, use statusText
      }
      throw new BudaApiError(response.status, path, `Buda API ${response.status}: ${detail}`);
    }

    return response.json() as Promise<T>;
  }
}
