export const X402_VERSION = 2 as const;
export const X402_BINDING_EXTENSION = "website-intelligence/request-binding" as const;

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402Extension {
  info: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions: Record<string, X402Extension>;
}

export interface ExactEvmAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: {
    signature: string;
    authorization: ExactEvmAuthorization;
  };
  extensions?: Record<string, X402Extension>;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, unknown>;
}

export interface FacilitatorRequest {
  x402Version: typeof X402_VERSION;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface FacilitatorAdapter {
  verify(request: FacilitatorRequest): Promise<VerifyResponse>;
  settle(request: FacilitatorRequest): Promise<SettlementResponse>;
}

export interface X402ProviderConfig {
  enabled: boolean;
  settlementEnabled: boolean;
  publicBaseUrl: string;
  endpointPath: "/v1/x402/audits";
  network: "eip155:84532";
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
    network: string;
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
