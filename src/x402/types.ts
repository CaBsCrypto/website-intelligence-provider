import type {
  PaymentPayload as CorePaymentPayload,
  PaymentRequired as CorePaymentRequired,
  PaymentRequirements as CorePaymentRequirements,
  ResourceInfo,
  SettleResponse,
  SupportedResponse as CoreSupportedResponse,
  VerifyResponse as CoreVerifyResponse
} from "@x402/core/types";
import type { ExactStellarPayloadV2 } from "@x402/stellar";

export const X402_VERSION = 2 as const;
export const X402_BINDING_EXTENSION = "website-intelligence/request-binding" as const;
export const STELLAR_TESTNET = "stellar:testnet" as const;

export interface PaymentRequirements extends Omit<CorePaymentRequirements, "scheme" | "network" | "extra"> {
  scheme: "exact";
  network: typeof STELLAR_TESTNET;
  extra: Record<string, unknown> & { areFeesSponsored: true };
}

export interface X402Extension {
  info: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface PaymentRequired extends Omit<CorePaymentRequired, "x402Version" | "accepts" | "extensions"> {
  x402Version: typeof X402_VERSION;
  accepts: PaymentRequirements[];
  extensions: Record<string, X402Extension>;
}

export interface PaymentPayload extends Omit<CorePaymentPayload, "x402Version" | "accepted" | "payload" | "extensions"> {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: ExactStellarPayloadV2;
  extensions?: Record<string, X402Extension>;
}

export type VerifyResponse = CoreVerifyResponse;
export type SettlementResponse = SettleResponse;
export type SupportedResponse = CoreSupportedResponse;

export interface FacilitatorRequest {
  x402Version: typeof X402_VERSION;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface FacilitatorAdapter {
  supported(): Promise<SupportedResponse>;
  verify(request: FacilitatorRequest): Promise<VerifyResponse>;
  settle(request: FacilitatorRequest): Promise<SettlementResponse>;
}

export interface X402ProviderConfig {
  enabled: boolean;
  settlementEnabled: boolean;
  publicBaseUrl: string;
  endpointPath: "/v1/x402/audits";
  network: typeof STELLAR_TESTNET;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds: number;
}

export interface X402Dependencies {
  config: X402ProviderConfig;
  facilitator: FacilitatorAdapter;
}

export interface ProviderReceipt {
  schemaVersion: "1.0";
  receiptId: string;
  provider: "website-intelligence";
  protocol: "x402";
  x402Version: typeof X402_VERSION;
  endpoint: "/v1/x402/audits";
  requestHash: string;
  outputHash: string;
  payment: {
    scheme: "exact";
    network: typeof STELLAR_TESTNET;
    amount: string;
    asset: string;
    payTo: string;
  };
  settlement: {
    success: true;
    transaction: string;
    payer?: string;
  };
}

export interface ReconciliationExpectation {
  request?: unknown;
  output?: unknown;
  network?: string;
  amount?: string;
  asset?: string;
  transaction?: string;
}

export interface ReconciliationResult {
  matched: boolean;
  receiptId: string;
  mismatches: string[];
}
