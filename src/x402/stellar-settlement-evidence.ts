import { Address, Networks, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import type { FacilitatorRequest, SettlementEvidenceVerifier, SettlementResponse } from "./types.js";

export class StellarSettlementEvidenceVerifier implements SettlementEvidenceVerifier {
  constructor(private readonly server = new rpc.Server("https://soroban-testnet.stellar.org")) {}

  async reconcile(request: FacilitatorRequest, settlement: SettlementResponse): Promise<SettlementResponse> {
    if (!settlement.success || !/^[a-fA-F0-9]{64}$/.test(settlement.transaction)) {
      throw new Error("SETTLEMENT_TRANSACTION_REQUIRED");
    }
    const result = await this.server.getTransaction(settlement.transaction);
    if (result.status !== "SUCCESS") throw new Error("SETTLEMENT_NOT_CONFIRMED");
    const envelope = TransactionBuilder.fromXDR(result.envelopeXdr, Networks.TESTNET);
    const transaction = "innerTransaction" in envelope ? envelope.innerTransaction : envelope;
    if (!transaction || transaction.operations.length !== 1) throw new Error("SETTLEMENT_OPERATION_MISMATCH");
    // Bind to the signed transaction or its exact Soroban authorization when the facilitator replaces the submitting account.
    if (request.paymentPayload.payload.transaction) {
      const signedEnvelope = TransactionBuilder.fromXDR(request.paymentPayload.payload.transaction, Networks.TESTNET);
      const signed = "innerTransaction" in signedEnvelope ? signedEnvelope.innerTransaction : signedEnvelope;
      if (!transaction.hash().equals(signed.hash())) {
        const actualOp = transaction.operations[0], signedOp = signed.operations[0];
        const sameAuthorization = actualOp?.type === "invokeHostFunction" && signedOp?.type === "invokeHostFunction"
          && actualOp.func.toXDR("base64") === signedOp.func.toXDR("base64")
          && (signedOp.auth?.length ?? 0) > 0 && actualOp.auth?.length === signedOp.auth?.length
          && signedOp.auth!.every((entry, index) => entry.credentials().switch().name === "sorobanCredentialsAddress"
            && entry.credentials().address().signature().switch().name === "scvVec"
            && entry.credentials().address().signature().vec()!.length > 0
            && entry.toXDR("base64") === actualOp.auth![index].toXDR("base64"));
        if (!sameAuthorization) throw new Error("SETTLEMENT_SIGNED_TRANSACTION_MISMATCH");
      }
    }
    const operation = transaction.operations[0];
    if (operation.type !== "invokeHostFunction" || operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
      throw new Error("SETTLEMENT_OPERATION_MISMATCH");
    }
    const invocation = operation.func.invokeContract();
    const args = invocation.args();
    const requirements = request.paymentRequirements;
    if (Address.fromScAddress(invocation.contractAddress()).toString() !== requirements.asset
      || invocation.functionName().toString() !== "transfer"
      || args.length !== 3) throw new Error("SETTLEMENT_ASSET_OR_FUNCTION_MISMATCH");
    const payer = String(scValToNative(args[0]));
    const payTo = String(scValToNative(args[1]));
    const amount = BigInt(scValToNative(args[2]));
    if (payTo !== requirements.payTo || amount !== BigInt(requirements.amount)) {
      throw new Error("SETTLEMENT_RECIPIENT_OR_AMOUNT_MISMATCH");
    }
    return { ...settlement, network: requirements.network, payer, amount: requirements.amount, ledger: result.ledger };
  }
}
