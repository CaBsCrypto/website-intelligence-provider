import type { PaymentDeliveryRecord, PaymentReplayStore } from "./types.js";

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
    const script = "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2]); redis.call('SET', KEYS[1], 'committed', 'EX', ARGV[2]); return 1";
    const result = await this.command(["EVAL", script, "2", this.reservationKey(fingerprint), this.deliveryKey(fingerprint), JSON.stringify(delivery), "86400"]);
    if (result !== 1) throw new Error("DURABLE_STORE_COMMIT_FAILED");
  }

  private reservationKey(fingerprint: string): string { return `${this.prefix}:reservation:${fingerprint}`; }
  private deliveryKey(fingerprint: string): string { return `${this.prefix}:delivery:${fingerprint}`; }

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
