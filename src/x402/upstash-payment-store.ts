import type { PaymentDeliveryRecord, PaymentReplayStore, RecoveryIntent } from "./types.js";
import { canonicalJson } from "./canonical.js";

type FetchLike = typeof fetch;

export class UpstashPaymentStore implements PaymentReplayStore {
  private readonly prefix = "website-intelligence:x402:v1";

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    if (!/^https:\/\//.test(url) || !token) throw new Error("DURABLE_STORE_CONFIG_INVALID");
  }

  async reserve(fingerprint: string): Promise<boolean> {
    const response = await this.command(["SET", this.reservationKey(fingerprint), "reserved", "NX", "EX", "300"]);
    return response === "OK";
  }

  async release(fingerprint: string): Promise<void> {
    await this.command(["DEL", this.reservationKey(fingerprint)]);
  }

  async getDelivery(fingerprint: string): Promise<PaymentDeliveryRecord | null> {
    const value = await this.command(["GET", this.deliveryKey(fingerprint)]);
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("DURABLE_STORE_RESPONSE_INVALID");
    return JSON.parse(value) as PaymentDeliveryRecord;
  }

  async commitDelivery(fingerprint: string, delivery: PaymentDeliveryRecord): Promise<void> {
    const script = delivery.recovery
      ? "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2]); redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[2]); redis.call('SET', KEYS[1], 'committed', 'EX', ARGV[2]); return 1"
      : "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2]); redis.call('SET', KEYS[1], 'committed', 'EX', ARGV[2]); return 1";
    const keys = delivery.recovery ? [this.reservationKey(fingerprint), this.deliveryKey(fingerprint), this.recoveryKey(delivery.recovery.recoveryId)] : [this.reservationKey(fingerprint), this.deliveryKey(fingerprint)];
    const result = await this.command(["EVAL", script, String(keys.length), ...keys, JSON.stringify(delivery), "86400"]);
    if (result !== 1) throw new Error("DURABLE_STORE_COMMIT_FAILED");
  }

  async getRecovery(recoveryId: string): Promise<PaymentDeliveryRecord | null> {
    const value = await this.command(["GET", this.recoveryKey(recoveryId)]);
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("DURABLE_STORE_RESPONSE_INVALID");
    return JSON.parse(value) as PaymentDeliveryRecord;
  }

  async reserveRecoveryIntent(intent: RecoveryIntent): Promise<"created" | "matched" | "conflict"> {
    const encoded = canonicalJson(intent);
    const created = await this.command(["SET", this.recoveryIntentKey(intent.requestId), encoded, "NX", "EX", "300"]);
    if (created === "OK") return "created";
    const prior = await this.command(["GET", this.recoveryIntentKey(intent.requestId)]);
    if (typeof prior !== "string") return "conflict";
    return prior === encoded ? "matched" : "conflict";
  }

  async getRecoveryIntent(requestId: string): Promise<RecoveryIntent | null> {
    const value = await this.command(["GET", this.recoveryIntentKey(requestId)]);
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("DURABLE_STORE_RESPONSE_INVALID");
    return JSON.parse(value) as RecoveryIntent;
  }

  private reservationKey(fingerprint: string): string { return `${this.prefix}:reservation:${fingerprint}`; }
  private deliveryKey(fingerprint: string): string { return `${this.prefix}:delivery:${fingerprint}`; }
  private recoveryKey(recoveryId: string): string { return `${this.prefix}:recovery:${recoveryId}`; }
  private recoveryIntentKey(requestId: string): string { return `${this.prefix}:recovery-intent:${requestId}`; }

  private async command(command: string[]): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error("DURABLE_STORE_UNAVAILABLE");
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error !== undefined || !("result" in payload)) throw new Error("DURABLE_STORE_RESPONSE_INVALID");
    return payload.result;
  }
}
