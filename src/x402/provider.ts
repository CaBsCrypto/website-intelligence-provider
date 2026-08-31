import type { IncomingMessage, ServerResponse } from "node:http";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { validateStellarDestinationAddress } from "@x402/stellar";
import { auditWebsite, AuditInputError } from "../audit.js";
import { readJsonBody, sendJson } from "../http.js";
import { FacilitatorAdapterError } from "./adapter.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { decodeX402Header, encodeX402Header, X402HeaderError } from "./encoding.js";
import { createReceipt } from "./receipt.js";
import { serviceCardHashForConfig } from "../service-card.js";
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
  required: ["algorithm", "method", "route", "inputHash", "cardHash"],
  properties: {
    algorithm: { const: "sha256-canonical-json-v1" },
    method: { const: "POST" },
    route: { const: "/v1/x402/audits" },
    inputHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    cardHash: { type: "string", pattern: "^[a-f0-9]{64}$" }
  },
  additionalProperties: false
} as const;

const stellarScheme = new ExactStellarScheme();

export function requestHashFor(request: unknown): string {
  return sha256(request);
}

function resourceUrl(config: X402ProviderConfig): string {
  return new URL(config.endpointPath, `${config.publicBaseUrl.replace(/\/$/, "")}/`).toString();
}

export async function paymentRequirementsFor(config: X402ProviderConfig): Promise<PaymentRequirements> {
  const enhanced = await stellarScheme.enhancePaymentRequirements({
    scheme: "exact",
    network: config.network,
    amount: config.amount,
    asset: config.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {}
  }, {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: config.network,
    extra: { areFeesSponsored: true }
  }, []);
  return enhanced as PaymentRequirements;
}

export async function createPaymentRequired(config: X402ProviderConfig, request: unknown, error = "PAYMENT-SIGNATURE header is required"): Promise<PaymentRequired> {
  return {
    x402Version: X402_VERSION,
    error,
    resource: {
      url: resourceUrl(config),
      description: "Deterministic Website Intelligence audit",
      mimeType: "application/json"
    },
    accepts: [await paymentRequirementsFor(config)],
    extensions: {
      [X402_BINDING_EXTENSION]: {
        info: {
          algorithm: "sha256-canonical-json-v1",
          method: "POST",
          route: config.endpointPath,
          inputHash: requestHashFor(request),
          cardHash: serviceCardHashForConfig(config)
        },
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
  if (!isRecord(payment.payload) || typeof payment.payload.transaction !== "string") return false;
  const transaction = payment.payload.transaction;
  return transaction.length > 0
    && transaction.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(transaction)
    && Buffer.from(transaction, "base64").length > 0;
}

function validateBinding(payment: PaymentPayload, required: PaymentRequired): string[] {
  const mismatches: string[] = [];
  const requirements = required.accepts[0];
  if (!payment.resource || canonicalJson(payment.resource) !== canonicalJson(required.resource)) mismatches.push("resource");
  if (canonicalJson(payment.accepted) !== canonicalJson(requirements)) mismatches.push("requirements");
  const requiredBinding = required.extensions[X402_BINDING_EXTENSION].info;
  const submittedBinding = payment.extensions?.[X402_BINDING_EXTENSION]?.info;
  if (canonicalJson(submittedBinding) !== canonicalJson(requiredBinding)) mismatches.push("request binding");
  return mismatches;
}

function paymentRequiredResponse(response: ServerResponse, required: PaymentRequired, error: string): void {
  const challenge = { ...required, error };
  sendJson(response, 402, { error }, { "payment-required": encodeX402Header(challenge) });
}

function adapterFailure(response: ServerResponse, error: unknown, phase: "support" | "verification" | "settlement"): void {
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
    sendJson(response, 503, {
      error: {
        code: "X402_NOT_CONFIGURED",
        message: "The Testnet payment route is inactive because required server-only configuration is missing."
      }
    });
    return;
  }

  const required = await createPaymentRequired(dependencies.config, body);
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

  let supported;
  try {
    supported = await dependencies.facilitator.supported();
  } catch (error) {
    adapterFailure(response, error, "support");
    return;
  }
  const supportsStellarExact = Array.isArray(supported.kinds) && supported.kinds.some((kind) =>
    kind.x402Version === X402_VERSION
    && kind.scheme === "exact"
    && kind.network === dependencies.config.network
    && kind.extra?.areFeesSponsored === true
  );
  if (!supportsStellarExact) {
    sendJson(response, 502, {
      error: {
        code: "X402_FACILITATOR_UNSUPPORTED",
        message: "Facilitator does not advertise sponsored x402 v2 exact support for stellar:testnet."
      }
    });
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

  if (dependencies.config.executionMode === "manual-single-process") {
    if (!dependencies.settlementAttemptGuard.tryConsume()) {
      sendJson(response, 409, {
        error: {
          code: "MANUAL_TESTNET_ATTEMPT_CONSUMED",
          message: "The one-shot Testnet validation process has already consumed its settlement attempt."
        }
      });
      return;
    }
  }

  const paymentFingerprint = sha256(payment);
  let reserved: boolean;
  try {
    reserved = await dependencies.paymentReplayStore.reserve(paymentFingerprint);
  } catch {
    sendJson(response, 503, {
      error: { code: "DURABLE_STORE_UNAVAILABLE", message: "Payment processing is unavailable because durable state cannot be reserved." }
    });
    return;
  }
  if (!reserved) {
    let priorDelivery;
    try {
      priorDelivery = await dependencies.paymentReplayStore.getDelivery(paymentFingerprint);
    } catch {
      sendJson(response, 503, {
        error: { code: "DURABLE_STORE_UNAVAILABLE", message: "Payment processing is unavailable because durable state cannot be read." }
      });
      return;
    }
    if (priorDelivery) {
      sendJson(response, 200, {
        result: priorDelivery.result,
        resultHash: priorDelivery.resultHash,
        receipt: priorDelivery.receipt
      }, { "payment-response": priorDelivery.paymentResponse });
      return;
    }
    sendJson(response, 409, {
      error: { code: "PAYMENT_REPLAY_REJECTED", message: "This payment authorization has already been processed." }
    });
    return;
  }
  let settlement: SettlementResponse;
  try {
    settlement = await dependencies.facilitator.settle(facilitatorRequest);
  } catch (error) {
    await dependencies.paymentReplayStore.release(paymentFingerprint);
    adapterFailure(response, error, "settlement");
    return;
  }
  const paymentResponse = encodeX402Header(settlement);
  if (!settlement.success) {
    await dependencies.paymentReplayStore.release(paymentFingerprint);
    sendJson(response, 402, {
      error: { code: "PAYMENT_SETTLEMENT_FAILED", message: settlement.errorReason ?? "Settlement failed" }
    }, { "payment-response": paymentResponse });
    return;
  }
  let reconciledSettlement = settlement;
  if (dependencies.settlementEvidenceVerifier) {
    try {
      reconciledSettlement = await dependencies.settlementEvidenceVerifier.reconcile(facilitatorRequest, settlement);
    } catch {
      await dependencies.paymentReplayStore.release(paymentFingerprint);
      sendJson(response, 502, {
        error: { code: "SETTLEMENT_EVIDENCE_MISMATCH", message: "On-chain settlement evidence does not match the accepted payment requirements." }
      }, { "payment-response": paymentResponse });
      return;
    }
  }
  const settlementMismatch = reconciledSettlement.network !== required.accepts[0].network
    || (reconciledSettlement.amount !== undefined && reconciledSettlement.amount !== required.accepts[0].amount)
    || (reconciledSettlement.ledger !== undefined && (!Number.isSafeInteger(reconciledSettlement.ledger) || reconciledSettlement.ledger <= 0))
    || !/^[a-fA-F0-9]{64}$/.test(reconciledSettlement.transaction)
    || (reconciledSettlement.payer !== undefined && !validateStellarDestinationAddress(reconciledSettlement.payer));
  if (settlementMismatch) {
    await dependencies.paymentReplayStore.release(paymentFingerprint);
    sendJson(response, 502, {
      error: { code: "INVALID_SETTLEMENT_RESPONSE", message: "Facilitator settlement does not match the exact Testnet requirements." }
    }, { "payment-response": paymentResponse });
    return;
  }

  const receipt = createReceipt({
    requestHash: requestHashFor(body),
    output,
    requirements: required.accepts[0],
    settlement: reconciledSettlement as SettlementResponse & { success: true },
    cardHash: required.extensions[X402_BINDING_EXTENSION].info.cardHash as string
  });
  const resultHash = sha256(output);
  try {
    await dependencies.paymentReplayStore.commitDelivery(paymentFingerprint, {
      result: output,
      resultHash,
      receipt,
      paymentResponse
    });
  } catch {
    sendJson(response, 503, {
      error: { code: "DELIVERY_PERSISTENCE_UNAVAILABLE", message: "Payment settled, but durable delivery persistence is unavailable. Manual recovery is required; settlement will not be retried." }
    }, { "payment-response": paymentResponse });
    return;
  }
  sendJson(response, 200, { result: output, resultHash, receipt }, { "payment-response": paymentResponse });
}
