import { sha256 } from "./canonical.js";
import type {
  PaymentRequirements,
  ProviderReceipt,
  ReconciliationExpectation,
  ReconciliationResult,
  SettlementResponse
} from "./types.js";

export function outputHashFor(output: unknown): string {
  return sha256(output);
}

export function createReceipt(input: {
  requestHash: string;
  output: unknown;
  requirements: PaymentRequirements;
  settlement: SettlementResponse & { success: true };
}): ProviderReceipt {
  const base = {
    schemaVersion: "1.0" as const,
    provider: "website-intelligence" as const,
    protocol: "x402" as const,
    x402Version: 2 as const,
    endpoint: "/v1/x402/audits" as const,
    requestHash: input.requestHash,
    outputHash: outputHashFor(input.output),
    payment: {
      scheme: "exact" as const,
      network: input.requirements.network,
      amount: input.requirements.amount,
      asset: input.requirements.asset,
      payTo: input.requirements.payTo
    },
    settlement: {
      success: true as const,
      transaction: input.settlement.transaction,
      ...(input.settlement.payer ? { payer: input.settlement.payer } : {})
    }
  };
  return { ...base, receiptId: `wir_${sha256(base).slice("sha256:".length, "sha256:".length + 32)}` };
}

function expectedReceiptId(receipt: ProviderReceipt): string {
  const { receiptId: _receiptId, ...base } = receipt;
  return `wir_${sha256(base).slice("sha256:".length, "sha256:".length + 32)}`;
}

export function reconcileReceipt(receipt: ProviderReceipt, expected: ReconciliationExpectation): ReconciliationResult {
  const mismatches: string[] = [];
  if (receipt.receiptId !== expectedReceiptId(receipt)) mismatches.push("receiptId");
  if (expected.request !== undefined && receipt.requestHash !== sha256(expected.request)) mismatches.push("requestHash");
  if (expected.output !== undefined && receipt.outputHash !== outputHashFor(expected.output)) mismatches.push("outputHash");
  if (expected.network !== undefined && receipt.payment.network !== expected.network) mismatches.push("network");
  if (expected.amount !== undefined && receipt.payment.amount !== expected.amount) mismatches.push("amount");
  if (expected.asset !== undefined && receipt.payment.asset.toLowerCase() !== expected.asset.toLowerCase()) mismatches.push("asset");
  if (expected.transaction !== undefined && receipt.settlement.transaction !== expected.transaction) mismatches.push("transaction");
  return { matched: mismatches.length === 0, receiptId: receipt.receiptId, mismatches };
}
