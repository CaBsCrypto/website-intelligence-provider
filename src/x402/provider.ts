import type { IncomingMessage, ServerResponse } from "node:http";
import { auditWebsite, AuditInputError } from "../audit.js";
import { readJsonBody, sendJson } from "../http.js";
import { FacilitatorAdapterError } from "./adapter.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { decodeX402Header, encodeX402Header, X402HeaderError } from "./encoding.js";
import { createReceipt } from "./receipt.js";
import {
  X402_BINDING_EXTENSION,
  X402_VERSION,
  type FacilitatorRequest,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
  type X402Dependencies,
  type X402ProviderConfig
} from "./types.js";

const BINDING_SCHEMA = {
  type: "object",
  required: ["algorithm", "requestHash"],
  properties: {
    algorithm: { const: "sha256" },
    requestHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  additionalProperties: false
} as const;

export function requestHashFor(request: unknown): string {
  return sha256(request);
}

function resourceUrl(config: X402ProviderConfig): string {
  return new URL(config.endpointPath, `${config.publicBaseUrl.replace(/\/$/, "")}/`).toString();
}

export function paymentRequirementsFor(config: X402ProviderConfig): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    amount: config.amount,
    asset: config.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: { name: "USDC", version: "2" }
  };
}

export function createPaymentRequired(config: X402ProviderConfig, request: unknown, error = "PAYMENT-SIGNATURE header is required"): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error,
    resource: {
      url: resourceUrl(config),
      description: "Deterministic Website Intelligence audit",
      mimeType: "application/json"
    },
    accepts: [paymentRequirementsFor(config)],
    extensions: {
      [X402_BINDING_EXTENSION]: {
        info: { algorithm: "sha256", requestHash: requestHashFor(request) },
        schema: BINDING_SCHEMA
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function paymentShapeIsValid(payment: unknown): payment is PaymentPayload {
  if (!isRecord(payment) || payment.x402Version !== X402_VERSION) return false;
  if (!isRecord(payment.accepted) || payment.accepted.scheme !== "exact") return false;
  if (!isRecord(payment.payload) || typeof payment.payload.signature !== "string" || payment.payload.signature.length === 0) return false;
  if (!isRecord(payment.payload.authorization)) return false;
  return ["from", "to", "value", "validAfter", "validBefore", "nonce"]
    .every((field) => typeof payment.payload.authorization[field] === "string");
}

function validateBinding(payment: PaymentPayload, required: PaymentRequired): string[] {
  const mismatches: string[] = [];
  const requirements = required.accepts[0];
  if (!payment.resource || canonicalJson(payment.resource) !== canonicalJson(required.resource)) mismatches.push("resource");
  if (canonicalJson(payment.accepted) !== canonicalJson(requirements)) mismatches.push("requirements");
  const requestHash = required.extensions[X402_BINDING_EXTENSION].info.requestHash;
  const submittedHash = payment.extensions?.[X402_BINDING_EXTENSION]?.info?.requestHash;
  if (submittedHash !== requestHash) mismatches.push("request binding");
  if (payment.payload.authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) mismatches.push("recipient");
  if (payment.payload.authorization.value !== requirements.amount) mismatches.push("amount authorization");
  return mismatches;
}

function paymentRequiredResponse(response: ServerResponse, required: PaymentRequired, error: string): void {
  const challenge = { ...required, error };
  sendJson(response, 402, { error }, { "payment-required": encodeX402Header(challenge) });
}

function adapterFailure(response: ServerResponse, error: unknown, phase: "verification" | "settlement"): void {
  const disabled = error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED";
  sendJson(response, disabled ? 503 : 502, {
    error: {
      code: disabled ? "X402_SETTLEMENT_DISABLED" : `PAYMENT_${phase.toUpperCase()}_UNAVAILABLE`,
      message: error instanceof Error ? error.message : `${phase} failed`
    }
  });
}

export async function handlePaidAuditRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: X402Dependencies
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    return;
  }

  let output: ReturnType<typeof auditWebsite>;
  try {
    output = auditWebsite(body as any);
  } catch (error) {
    if (error instanceof AuditInputError) {
      sendJson(response, error.code === "FIXTURE_NOT_FOUND" ? 404 : 400, { error: { code: error.code, message: error.message } });
      return;
    }
    sendJson(response, 400, { error: { code: "INVALID_REQUEST", message: "Audit request is invalid." } });
    return;
  }

  if (!dependencies.config.enabled) {
    sendJson(response, 503, { error: { code: "X402_NOT_CONFIGURED", message: "Set X402_PAY_TO to a Testnet recipient address." } });
    return;
  }

  const required = createPaymentRequired(dependencies.config, body);
  const encodedPayment = request.headers["payment-signature"];
  if (!encodedPayment || Array.isArray(encodedPayment)) {
    paymentRequiredResponse(response, required, "PAYMENT-SIGNATURE header is required");
    return;
  }

  let payment: PaymentPayload;
  try {
    payment = decodeX402Header<PaymentPayload>(encodedPayment);
    if (!paymentShapeIsValid(payment)) throw new X402HeaderError("payment payload does not match x402 v2 exact schema");
  } catch (error) {
    sendJson(response, 400, { error: { code: "INVALID_PAYMENT_HEADER", message: error instanceof Error ? error.message : "Invalid payment header." } });
    return;
  }

  const mismatches = validateBinding(payment, required);
  if (mismatches.length) {
    paymentRequiredResponse(response, required, `Payment does not match ${mismatches.join(", ")}`);
    return;
  }

  if (!dependencies.config.settlementEnabled) {
    sendJson(response, 503, { error: { code: "X402_SETTLEMENT_DISABLED", message: "Testnet settlement is disabled by default." } });
    return;
  }

  const facilitatorRequest: FacilitatorRequest = {
    x402Version: X402_VERSION,
    paymentPayload: payment,
    paymentRequirements: required.accepts[0]
  };
  let verification;
  try {
    verification = await dependencies.facilitator.verify(facilitatorRequest);
  } catch (error) {
    adapterFailure(response, error, "verification");
    return;
  }
  if (!verification.isValid) {
    paymentRequiredResponse(response, required, verification.invalidReason ?? "Payment verification failed");
    return;
  }

  let settlement: SettlementResponse;
  try {
    settlement = await dependencies.facilitator.settle(facilitatorRequest);
  } catch (error) {
    adapterFailure(response, error, "settlement");
    return;
  }
  const paymentResponse = encodeX402Header(settlement);
  if (!settlement.success) {
    sendJson(response, 402, {
      error: { code: "PAYMENT_SETTLEMENT_FAILED", message: settlement.errorReason ?? "Settlement failed" }
    }, { "payment-response": paymentResponse });
    return;
  }
  const settlementMismatch = settlement.network !== required.accepts[0].network
    || (settlement.amount !== undefined && settlement.amount !== required.accepts[0].amount)
    || !/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction);
  if (settlementMismatch) {
    sendJson(response, 502, {
      error: { code: "INVALID_SETTLEMENT_RESPONSE", message: "Facilitator settlement does not match the exact Testnet requirements." }
    }, { "payment-response": paymentResponse });
    return;
  }

  const receipt = createReceipt({
    requestHash: requestHashFor(body),
    output,
    requirements: required.accepts[0],
    settlement: settlement as SettlementResponse & { success: true }
  });
  sendJson(response, 200, { data: output, receipt }, { "payment-response": paymentResponse });
}
