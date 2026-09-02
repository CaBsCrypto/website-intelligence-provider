import type { PaymentDeliveryRecord, PaymentReplayStore, RecoveryIntent, SettlementAttemptGuard } from "./types.js";
import { canonicalJson } from "./canonical.js";

export function createSettlementAttemptGuard(): SettlementAttemptGuard {
  let consumed = false;
  return {
    tryConsume(): boolean {
      if (consumed) return false;
      consumed = true;
      return true;
    }
  };
}

// The production runtime deliberately shares one guard across every server or
// dependency object created in this Node.js process.
export const processSettlementAttemptGuard = createSettlementAttemptGuard();

export function createPaymentReplayStore(): PaymentReplayStore {
  const reservations = new Set<string>();
  const deliveries = new Map<string, PaymentDeliveryRecord>();
  const recoveries = new Map<string, PaymentDeliveryRecord>();
  const recoveryIntents = new Map<string, RecoveryIntent>();
  return {
    async reserve(fingerprint: string): Promise<boolean> {
      if (reservations.has(fingerprint)) return false;
      reservations.add(fingerprint);
      return true;
    },
    async release(fingerprint: string): Promise<void> {
      reservations.delete(fingerprint);
    },
    async getDelivery(fingerprint: string): Promise<PaymentDeliveryRecord | null> {
      return deliveries.get(fingerprint) ?? null;
    },
    async commitDelivery(fingerprint: string, delivery: PaymentDeliveryRecord): Promise<void> {
      deliveries.set(fingerprint, delivery);
      if (delivery.recovery) recoveries.set(delivery.recovery.recoveryId, delivery);
    },
    async getRecovery(recoveryId: string): Promise<PaymentDeliveryRecord | null> {
      return recoveries.get(recoveryId) ?? null;
    },
    async reserveRecoveryIntent(intent: RecoveryIntent) {
      const prior = recoveryIntents.get(intent.requestId);
      if (!prior) { recoveryIntents.set(intent.requestId, structuredClone(intent)); return "created"; }
      return canonicalJson(prior) === canonicalJson(intent) ? "matched" : "conflict";
    },
    async getRecoveryIntent(requestId: string) {
      return recoveryIntents.get(requestId) ?? null;
    }
  };
}

export const processPaymentReplayStore = createPaymentReplayStore();
