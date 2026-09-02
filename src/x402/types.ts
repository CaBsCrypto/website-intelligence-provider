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
export type SettlementResponse = SettleResponse & { amount?: string; ledger?: number };
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
  executionMode: "disabled" | "manual-single-process" | "durable-multi-instance";
  configurationErrors: string[];
  publicBaseUrl: string;
  endpointPath: "/v1/x402/audits";
  network: typeof STELLAR_TESTNET;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds: number;
}

export interface SettlementAttemptGuard {
  tryConsume(): boolean;
}

export interface PaymentReplayStore {
  reserve(fingerprint: string): Promise<boolean>;
  release(fingerprint: string): Promise<void>;
  getDelivery(fingerprint: string): Promise<PaymentDeliveryRecord | null>;
  commitDelivery(fingerprint: string, delivery: PaymentDeliveryRecord): Promise<void>;
  getRecovery(recoveryId: string): Promise<PaymentDeliveryRecord | null>;
  reserveRecoveryIntent(intent: RecoveryIntent): Promise<"created" | "matched" | "conflict">;
  getRecoveryIntent(requestId: string): Promise<RecoveryIntent | null>;
}

export interface RecoveryIntent { requestId: string; proof: string; inputHash: string; cardHash: string }

export interface PaymentDeliveryRecord {
  result: unknown;
  resultHash: string;
  receipt: ProviderReceipt;
  paymentResponse: string;
  recovery?: { recoveryId: string; requestId: string; proof: string; expiresAt: string };
}

export interface SettlementEvidenceVerifier {
  reconcile(request: FacilitatorRequest, settlement: SettlementResponse): Promise<SettlementResponse>;
}

export interface X402Dependencies {
  config: X402ProviderConfig;
  facilitator: FacilitatorAdapter;
  settlementAttemptGuard: SettlementAttemptGuard;
  paymentReplayStore: PaymentReplayStore;
  settlementEvidenceVerifier?: SettlementEvidenceVerifier;
}

export interface ProviderReceipt {
  status: "settled";
  scheme: "exact";
  network: typeof STELLAR_TESTNET;
  asset: string;
  payTo: string;
  amount: string;
  method: "POST";
  route: "/v1/x402/audits";
  inputHash: string;
  resultHash: string;
  cardHash: string;
  transactionHash: string;
  ledger: number;
}

export interface ReconciliationExpectation {
  request?: unknown;
  output?: unknown;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  transaction?: string;
  ledger?: number;
}

export interface ReconciliationResult {
  matched: boolean;
  receiptId?: string;
  mismatches: string[];
}
