import test from "node:test";
import assert from "node:assert/strict";
import { DisabledFacilitatorAdapter, FacilitatorAdapterError, HttpFacilitatorAdapter } from "../src/x402/adapter.js";
import { loadX402Config } from "../src/x402/config.js";
import type { FacilitatorRequest } from "../src/x402/types.js";

const facilitatorRequest: FacilitatorRequest = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    accepted: {
      scheme: "exact", network: "eip155:84532", amount: "1000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60
    },
    payload: {
      signature: "fixture-signature",
      authorization: { from: "payer", to: "payee", value: "1000", validAfter: "1", validBefore: "2", nonce: "nonce" }
    }
  },
  paymentRequirements: {
    scheme: "exact", network: "eip155:84532", amount: "1000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    maxTimeoutSeconds: 60
  }
};

test("runtime configuration is Testnet-only and settlement-off by default", () => {
  const disabled = loadX402Config({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.settlementEnabled, false);
  assert.equal(disabled.network, "eip155:84532");

  const configured = loadX402Config({ X402_PAY_TO: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" });
  assert.equal(configured.enabled, true);
  assert.equal(configured.settlementEnabled, false);
});

test("disabled adapter cannot verify or settle", async () => {
  const adapter = new DisabledFacilitatorAdapter();
  await assert.rejects(adapter.verify(facilitatorRequest), (error: unknown) =>
    error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED");
  await assert.rejects(adapter.settle(facilitatorRequest), (error: unknown) =>
    error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED");
});

test("HTTP adapter keeps verify and settle behind explicit facilitator endpoints", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const settlement = String(input).endsWith("/settle");
    return new Response(JSON.stringify(settlement
      ? { success: true, transaction: `0x${"1".repeat(64)}`, network: "eip155:84532", payer: "payer" }
      : { isValid: true, payer: "payer" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new HttpFacilitatorAdapter({
    baseUrl: "https://facilitator.test/", bearerToken: "fixture-token", fetchImpl
  });
  assert.equal((await adapter.verify(facilitatorRequest)).isValid, true);
  assert.equal((await adapter.settle(facilitatorRequest)).success, true);
  assert.deepEqual(calls.map(({ url }) => url), ["https://facilitator.test/verify", "https://facilitator.test/settle"]);
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal((call.init.headers as Record<string, string>).authorization, "Bearer fixture-token");
    assert.deepEqual(JSON.parse(String(call.init.body)), facilitatorRequest);
  }
});
