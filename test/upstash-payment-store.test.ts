import test from "node:test";
import assert from "node:assert/strict";
import { UpstashPaymentStore } from "../src/x402/upstash-payment-store.js";
import type { PaymentDeliveryRecord } from "../src/x402/types.js";

const delivery: PaymentDeliveryRecord = {
  result: { score: 90 },
  resultHash: "a".repeat(64),
  paymentResponse: "redacted-header-fixture",
  receipt: {
    status: "settled", scheme: "exact", network: "stellar:testnet",
    asset: "C" + "A".repeat(55), payTo: "G" + "A".repeat(55), amount: "10000",
    method: "POST", route: "/v1/x402/audits", inputHash: "b".repeat(64),
    resultHash: "a".repeat(64), cardHash: "c".repeat(64), transactionHash: "d".repeat(64), ledger: 123
  }
};

test("durable store uses atomic NX reservation and atomic delivery commit", async () => {
  const commands: unknown[][] = [];
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    commands.push(command);
    const operation = command[0];
    const result = operation === "SET" ? "OK" : operation === "EVAL" ? 1 : operation === "GET" ? JSON.stringify(delivery) : 1;
    return new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const store = new UpstashPaymentStore("https://durable.example", "server-only-token", fetchMock as typeof fetch);
  assert.equal(await store.reserve("f".repeat(64)), true);
  await store.commitDelivery("f".repeat(64), delivery);
  assert.deepEqual(await store.getDelivery("f".repeat(64)), delivery);
  assert.deepEqual(commands[0]?.slice(0, 2), ["SET", `website-intelligence:x402:v1:reservation:${"f".repeat(64)}`]);
  assert.equal(commands[0]?.includes("NX"), true);
  assert.equal(commands[1]?.[0], "EVAL");
});

test("durable store fails closed on unavailable or conflicting reservations", async () => {
  const conflict = new UpstashPaymentStore("https://durable.example", "token", async () => new Response(JSON.stringify({ result: null }), { status: 200 }) as any);
  assert.equal(await conflict.reserve("f".repeat(64)), false);
  const unavailable = new UpstashPaymentStore("https://durable.example", "token", async () => new Response("unavailable", { status: 503 }) as any);
  await assert.rejects(() => unavailable.reserve("f".repeat(64)), /DURABLE_STORE_UNAVAILABLE/);
});
