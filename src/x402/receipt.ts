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
  cardHash: string;
}): ProviderReceipt {
  if (!Number.isSafeInteger(input.settlement.ledger) || Number(input.settlement.ledger) <= 0) {
    throw new Error("SETTLEMENT_LEDGER_REQUIRED");
  }
  return {
    status: "settled",
    scheme: "exact",
    network: input.requirements.network,
    asset: input.requirements.asset,
    payTo: input.requirements.payTo,
    amount: input.requirements.amount,
    method: "POST",
    route: "/v1/x402/audits",
    inputHash: input.requestHash,
    resultHash: outputHashFor(input.output),
    cardHash: input.cardHash,
    transactionHash: input.settlement.transaction,
    ledger: input.settlement.ledger!
  };
}

export function reconcileReceipt(receipt: ProviderReceipt, expected: ReconciliationExpectation): ReconciliationResult {
  const mismatches: string[] = [];
  if (expected.request !== undefined && receipt.inputHash !== sha256(expected.request)) mismatches.push("inputHash");
  if (expected.output !== undefined && receipt.resultHash !== outputHashFor(expected.output)) mismatches.push("resultHash");
  if (expected.network !== undefined && receipt.network !== expected.network) mismatches.push("network");
  if (expected.amount !== undefined && receipt.amount !== expected.amount) mismatches.push("amount");
  if (expected.asset !== undefined && receipt.asset.toLowerCase() !== expected.asset.toLowerCase()) mismatches.push("asset");
  if (expected.payTo !== undefined && receipt.payTo !== expected.payTo) mismatches.push("payTo");
  if (expected.transaction !== undefined && receipt.transactionHash !== expected.transaction) mismatches.push("transactionHash");
  if (expected.ledger !== undefined && receipt.ledger !== expected.ledger) mismatches.push("ledger");
  return { matched: mismatches.length === 0, mismatches };
}
