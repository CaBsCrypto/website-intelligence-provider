import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type { FacilitatorAdapter, FacilitatorRequest, SettlementResponse, SupportedResponse, VerifyResponse } from "./types.js";

export class FacilitatorAdapterError extends Error {
  constructor(message: string, public readonly code: "SETTLEMENT_DISABLED" | "FACILITATOR_ERROR") {
    super(message);
    this.name = "FacilitatorAdapterError";
  }
}

export class DisabledFacilitatorAdapter implements FacilitatorAdapter {
  async supported(): Promise<SupportedResponse> {
    throw new FacilitatorAdapterError("x402 facilitator calls are disabled", "SETTLEMENT_DISABLED");
  }

  async verify(_request: FacilitatorRequest): Promise<VerifyResponse> {
    throw new FacilitatorAdapterError("x402 facilitator calls are disabled", "SETTLEMENT_DISABLED");
  }

  async settle(_request: FacilitatorRequest): Promise<SettlementResponse> {
    throw new FacilitatorAdapterError("x402 settlement is disabled", "SETTLEMENT_DISABLED");
  }
}

type FacilitatorClientBoundary = Pick<FacilitatorClient, "getSupported" | "verify" | "settle">;

export interface HttpFacilitatorOptions {
  baseUrl: string;
  bearerToken?: string;
  client?: FacilitatorClientBoundary;
}

export class HttpFacilitatorAdapter implements FacilitatorAdapter {
  private readonly client: FacilitatorClientBoundary;

  constructor(options: HttpFacilitatorOptions) {
    this.client = options.client ?? new HTTPFacilitatorClient({
      url: options.baseUrl.replace(/\/$/, ""),
      ...(options.bearerToken ? {
        createAuthHeaders: async () => {
          const headers = { Authorization: `Bearer ${options.bearerToken}` };
          return { supported: headers, verify: headers, settle: headers };
        }
      } : {})
    });
  }

  supported(): Promise<SupportedResponse> {
    return this.call(() => this.client.getSupported());
  }

  verify(request: FacilitatorRequest): Promise<VerifyResponse> {
    return this.call(() => this.client.verify(request.paymentPayload, request.paymentRequirements));
  }

  settle(request: FacilitatorRequest): Promise<SettlementResponse> {
    return this.call(() => this.client.settle(request.paymentPayload, request.paymentRequirements));
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new FacilitatorAdapterError("official x402 facilitator client request failed", "FACILITATOR_ERROR");
    }
  }
}
