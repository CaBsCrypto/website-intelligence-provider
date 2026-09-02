import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../http.js";
import { sha256 } from "./canonical.js";
import type { X402Dependencies } from "./types.js";

export const RECOVERY_VERSION = "website-intelligence.delivery-recovery/v1" as const;
export const RECOVERY_PATH = "/v1/x402/audits/recover" as const;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export function recoveryProofForToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createRecoveryBinding(input: { requestId: string; proof: string; inputHash: string; cardHash: string; now?: Date }) {
  if (!HEX_32.test(input.requestId) || !HEX_64.test(input.proof)) throw new Error("RECOVERY_BINDING_INVALID");
  const recoveryId = sha256({ requestId: input.requestId, proof: input.proof, inputHash: input.inputHash, cardHash: input.cardHash });
  const now = input.now ?? new Date();
  return { recoveryId, requestId: input.requestId, proof: input.proof, expiresAt: new Date(now.getTime() + 86_400_000).toISOString() };
}

function hashesMatch(left: string, right: string): boolean {
  if (!HEX_64.test(left) || !HEX_64.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function handleDeliveryRecovery(request: IncomingMessage, response: ServerResponse, dependencies: Pick<X402Dependencies, "paymentReplayStore" | "config">): Promise<void> {
  let body: any;
  try { body = await readJsonBody(request); } catch { return sendJson(response, 400, { error: { code: "INVALID_JSON", message: "Recovery request must be valid JSON." } }); }
  if (body?.version !== RECOVERY_VERSION || !HEX_64.test(body?.recoveryId) || !HEX_32.test(body?.requestId) || !TOKEN.test(body?.recoveryToken)) return sendJson(response, 400, { error: { code: "RECOVERY_REQUEST_INVALID", message: "Recovery request is malformed." } });
  let delivery;
  try { delivery = await dependencies.paymentReplayStore.getRecovery(body.recoveryId); }
  catch { return sendJson(response, 503, { error: { code: "DURABLE_STORE_UNAVAILABLE", message: "Recovery storage is unavailable." } }); }
  if (!delivery?.recovery) return sendJson(response, 404, { error: { code: "RECOVERY_NOT_FOUND", message: "No delivery is available for this recovery ID." } });
  const expiry = Date.parse(delivery.recovery.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== delivery.recovery.expiresAt) return sendJson(response, 422, { error: { code: "RECOVERY_RECORD_INVALID", message: "Stored recovery evidence is malformed." } });
  if (expiry <= Date.now()) return sendJson(response, 410, { error: { code: "RECOVERY_EXPIRED", message: "Recovery capability has expired." } });
  const authorized = delivery.recovery.requestId === body.requestId && hashesMatch(delivery.recovery.proof, recoveryProofForToken(body.recoveryToken));
  if (!authorized) return sendJson(response, 403, { error: { code: "RECOVERY_UNAUTHORIZED", message: "Recovery capability does not match this delivery." } });
  const receipt = delivery.receipt;
  const recordValid = delivery.recovery.recoveryId === body.recoveryId
    && body.recoveryId === sha256({ requestId: delivery.recovery.requestId, proof: delivery.recovery.proof, inputHash: receipt.inputHash, cardHash: receipt.cardHash })
    && HEX_64.test(delivery.resultHash) && sha256(delivery.result) === delivery.resultHash && receipt.resultHash === delivery.resultHash
    && receipt.status === "settled" && receipt.scheme === "exact" && receipt.network === dependencies.config.network
    && receipt.asset === dependencies.config.asset && receipt.amount === dependencies.config.amount && receipt.payTo === dependencies.config.payTo
    && receipt.method === "POST" && receipt.route === dependencies.config.endpointPath && HEX_64.test(receipt.inputHash) && HEX_64.test(receipt.cardHash)
    && HEX_64.test(receipt.transactionHash) && Number.isSafeInteger(receipt.ledger) && receipt.ledger > 0;
  if (!recordValid) return sendJson(response, 422, { error: { code: "RECOVERY_RECORD_INVALID", message: "Stored delivery does not reconcile with the active service contract." } });
  return sendJson(response, 200, { version: "website-intelligence.recovered-delivery/v1", recovery: { recoveryId: delivery.recovery.recoveryId, requestId: delivery.recovery.requestId, status: "recovered" }, result: delivery.result, resultHash: delivery.resultHash, receipt: delivery.receipt });
}
