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

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Perform an authenticated GET request.
   *
   * Private endpoints (balances, orders, etc.) require HMAC-SHA2 signing.
   * To add auth later, extend this method with the `apiKey` + `apiSecret`
   * constructor params and sign the nonce/path headers here before fetching.
   */
  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "buda-mcp/1.0.0",
      },
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
