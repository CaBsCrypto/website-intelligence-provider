import type { FacilitatorAdapter, FacilitatorRequest, SettlementResponse, VerifyResponse } from "./types.js";

export class FacilitatorAdapterError extends Error {
  constructor(message: string, public readonly code: "SETTLEMENT_DISABLED" | "FACILITATOR_ERROR") {
    super(message);
    this.name = "FacilitatorAdapterError";
  }
}

export class DisabledFacilitatorAdapter implements FacilitatorAdapter {
  async verify(_request: FacilitatorRequest): Promise<VerifyResponse> {
    throw new FacilitatorAdapterError("x402 facilitator calls are disabled", "SETTLEMENT_DISABLED");
  }

  async settle(_request: FacilitatorRequest): Promise<SettlementResponse> {
    throw new FacilitatorAdapterError("x402 settlement is disabled", "SETTLEMENT_DISABLED");
  }
}

export interface HttpFacilitatorOptions {
  baseUrl: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
}

export class HttpFacilitatorAdapter implements FacilitatorAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpFacilitatorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  verify(request: FacilitatorRequest): Promise<VerifyResponse> {
    return this.post<VerifyResponse>("/verify", request);
  }

  settle(request: FacilitatorRequest): Promise<SettlementResponse> {
    return this.post<SettlementResponse>("/settle", request);
  }

  private async post<T>(path: string, body: FacilitatorRequest): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.bearerToken) headers.authorization = `Bearer ${this.options.bearerToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new FacilitatorAdapterError("facilitator request failed", "FACILITATOR_ERROR");
    }
    if (!response.ok) throw new FacilitatorAdapterError(`facilitator returned HTTP ${response.status}`, "FACILITATOR_ERROR");
    try {
      return await response.json() as T;
    } catch {
      throw new FacilitatorAdapterError("facilitator returned invalid JSON", "FACILITATOR_ERROR");
    }
  }
}
