import type { PaymentDeliveryRecord, PaymentReplayStore, SettlementAttemptGuard } from "./types.js";

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
    }
  };
}

export const processPaymentReplayStore = createPaymentReplayStore();
