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

test("durable store indexes a recovery record atomically with delivery", async () => {
  const commands: unknown[][] = [];
  const recoverable = { ...delivery, recovery: { recoveryId: "e".repeat(64), requestId: "f".repeat(32), proof: "a".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z" } };
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[]; commands.push(command);
    return new Response(JSON.stringify({ result: command[0] === "EVAL" ? 1 : JSON.stringify(recoverable) }), { status: 200 });
  };
  const store = new UpstashPaymentStore("https://durable.example", "server-only-token", fetchMock as typeof fetch);
  await store.commitDelivery("f".repeat(64), recoverable);
  assert.equal(commands[0]?.[2], "3");
  assert.equal(String(commands[0]?.[5]).includes(":recovery:"), true);
  assert.deepEqual(await store.getRecovery("e".repeat(64)), recoverable);
});

test("durable store fails closed on unavailable or conflicting reservations", async () => {
  const conflict = new UpstashPaymentStore("https://durable.example", "token", async () => new Response(JSON.stringify({ result: null }), { status: 200 }) as any);
  assert.equal(await conflict.reserve("f".repeat(64)), false);
  const unavailable = new UpstashPaymentStore("https://durable.example", "token", async () => new Response("unavailable", { status: 503 }) as any);
  await assert.rejects(() => unavailable.reserve("f".repeat(64)), /DURABLE_STORE_UNAVAILABLE/);
});

test("durable recovery intent is first-writer immutable", async () => {
  let stored: string | null = null;
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
    if (command[0] === "SET") { if (stored === null) { stored = command[2]; return new Response(JSON.stringify({ result: "OK" }), { status: 200 }); } return new Response(JSON.stringify({ result: null }), { status: 200 }); }
    if (command[0] === "GET") return new Response(JSON.stringify({ result: stored }), { status: 200 });
    return new Response(JSON.stringify({ result: null }), { status: 200 });
  };
  const store = new UpstashPaymentStore("https://durable.example", "token", fetchMock as typeof fetch);
  const intent = { requestId: "a".repeat(32), proof: "b".repeat(64), inputHash: "c".repeat(64), cardHash: "d".repeat(64) };
  assert.equal(await store.reserveRecoveryIntent(intent), "created");
  assert.equal(await store.reserveRecoveryIntent(intent), "matched");
  assert.equal(await store.reserveRecoveryIntent({ ...intent, proof: "e".repeat(64) }), "conflict");
  assert.deepEqual(await store.getRecoveryIntent(intent.requestId), intent);
});
