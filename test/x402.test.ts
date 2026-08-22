import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../src/server.js";
import { encodeX402Header, decodeX402Header } from "../src/x402/encoding.js";
import { createPaymentRequired, requestHashFor } from "../src/x402/provider.js";
import { reconcileReceipt } from "../src/x402/receipt.js";
import type {
  FacilitatorAdapter,
  PaymentPayload,
  PaymentRequirements,
  SettlementResponse,
  VerifyResponse,
  X402ProviderConfig
} from "../src/x402/types.js";

const config: X402ProviderConfig = {
  enabled: true,
  settlementEnabled: true,
  publicBaseUrl: "https://provider.test",
  endpointPath: "/v1/x402/audits",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  amount: "1000",
  maxTimeoutSeconds: 60
};

class FakeFacilitator implements FacilitatorAdapter {
  verifyCalls = 0;
  settleCalls = 0;

  constructor(
    private readonly verifyResult: VerifyResponse = { isValid: true, payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66" },
    private readonly settleResult: SettlementResponse = {
      success: true,
      payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      transaction: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      network: "eip155:84532",
      amount: "1000"
    }
  ) {}

  async verify(): Promise<VerifyResponse> {
    this.verifyCalls += 1;
    return this.verifyResult;
  }

  async settle(): Promise<SettlementResponse> {
    this.settleCalls += 1;
    return this.settleResult;
  }
}

async function withServer(
  adapter: FacilitatorAdapter,
  run: (origin: string) => Promise<void>,
  serverConfig: X402ProviderConfig = config
): Promise<void> {
  const server = createAppServer({ config: serverConfig, facilitator: adapter });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function validPayment(body: object, overrides: Partial<PaymentPayload> = {}): PaymentPayload {
  const required = createPaymentRequired(config, body);
  const accepted = required.accepts[0] as PaymentRequirements;
  return {
    x402Version: 2,
    resource: required.resource,
    accepted,
    payload: {
      signature: "0xfixture-signature",
      authorization: {
        from: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "1",
        validBefore: "9999999999",
        nonce: "0xfixture-nonce"
      }
    },
    extensions: required.extensions,
    ...overrides
  };
}

test("protected exact-price endpoint returns a genuine x402 v2 402 challenge", async () => {
  const adapter = new FakeFacilitator();
  await withServer(adapter, async (origin) => {
    const body = { url: "https://example.com/", language: "en" };
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    const encoded = response.headers.get("payment-required");
    assert(encoded);
    const required = decodeX402Header(encoded);
    assert.equal(required.x402Version, 2);
    assert.equal(required.accepts[0].scheme, "exact");
    assert.equal(required.accepts[0].amount, "1000");
    assert.equal(required.accepts[0].network, "eip155:84532");
    assert.equal(required.extensions["website-intelligence/request-binding"].info.requestHash, requestHashFor(body));
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("rejects malformed payment headers before facilitator verification", async () => {
  const adapter = new FakeFacilitator();
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": "not-base64-json" },
      body: JSON.stringify({ url: "https://example.com/" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PAYMENT_HEADER");
    assert.equal(adapter.verifyCalls, 0);
  });
});

test("rejects payment bound to a different request, amount, or resource", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "es" };
  const payment = validPayment(body);
  payment.extensions!["website-intelligence/request-binding"].info.requestHash = "sha256:wrong";
  payment.accepted = { ...payment.accepted, amount: "999" };
  payment.resource = { ...payment.resource!, url: "https://provider.test/v1/x402/other" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(payment) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    assert.match((await response.json()).error, /binding|requirements|resource/i);
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("does not settle when facilitator verification fails", async () => {
  const adapter = new FakeFacilitator({ isValid: false, invalidReason: "invalid_signature" });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    assert.equal(adapter.verifyCalls, 1);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("withholds provider output when settlement fails", async () => {
  const adapter = new FakeFacilitator(undefined, {
    success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:84532"
  });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    const paymentResponse = response.headers.get("payment-response");
    assert(paymentResponse);
    assert.equal(decodeX402Header(paymentResponse).success, false);
    assert.deepEqual(await response.json(), { error: { code: "PAYMENT_SETTLEMENT_FAILED", message: "insufficient_funds" } });
  });
});

test("rejects a successful settlement response that changes network, amount, or transaction", async () => {
  const adapter = new FakeFacilitator(undefined, {
    success: true, transaction: "0xshort", network: "eip155:1", amount: "999"
  });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "INVALID_SETTLEMENT_RESPONSE");
  });
});

test("does not call facilitator while settlement remains disabled", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "X402_SETTLEMENT_DISABLED");
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  }, { ...config, settlementEnabled: false });
});

test("fails closed when the payment recipient is not configured", async () => {
  const adapter = new FakeFacilitator();
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "X402_NOT_CONFIGURED");
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  }, { ...config, enabled: false, payTo: "" });
});

test("returns bound output, settlement header, and reconcilable receipt after success", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "es" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.equal(decodeX402Header(response.headers.get("payment-response")!).success, true);
    const result = await response.json();
    assert.equal(result.data.language, "es");
    assert.equal(result.receipt.requestHash, requestHashFor(body));
    assert.equal(result.receipt.payment.amount, "1000");
    assert.equal(adapter.verifyCalls, 1);
    assert.equal(adapter.settleCalls, 1);
    assert.deepEqual(reconcileReceipt(result.receipt, {
      request: body,
      output: result.data,
      network: config.network,
      amount: config.amount,
      asset: config.asset,
      transaction: result.receipt.settlement.transaction
    }), { matched: true, receiptId: result.receipt.receiptId, mismatches: [] });

    const tampered = reconcileReceipt(result.receipt, { request: { ...body, language: "en" }, output: result.data });
    assert.equal(tampered.matched, false);
    assert(tampered.mismatches.includes("requestHash"));
  });
});
