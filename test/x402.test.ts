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
  SupportedResponse,
  VerifyResponse,
  X402ProviderConfig
} from "../src/x402/types.js";

const PAY_TO = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";
const PAYER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const XDR_FIXTURE = Buffer.from("signed-stellar-xdr-fixture", "utf8").toString("base64");

const config: X402ProviderConfig = {
  enabled: true,
  settlementEnabled: true,
  publicBaseUrl: "https://provider.test",
  endpointPath: "/v1/x402/audits",
  network: "stellar:testnet",
  asset: ASSET,
  payTo: PAY_TO,
  amount: "10000",
  maxTimeoutSeconds: 60
};

class FakeFacilitator implements FacilitatorAdapter {
  supportedCalls = 0;
  verifyCalls = 0;
  settleCalls = 0;

  constructor(
    private readonly verifyResult: VerifyResponse = { isValid: true, payer: PAYER },
    private readonly settleResult: SettlementResponse = {
      success: true,
      payer: PAYER,
      transaction: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      network: "stellar:testnet",
      amount: "10000"
    },
    private readonly supportedResult: SupportedResponse = {
      kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }],
      extensions: [],
      signers: { "stellar:*": [PAY_TO] }
    }
  ) {}

  async supported(): Promise<SupportedResponse> {
    this.supportedCalls += 1;
    return this.supportedResult;
  }

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

async function validPayment(body: object, overrides: Partial<PaymentPayload> = {}): Promise<PaymentPayload> {
  const required = await createPaymentRequired(config, body);
  const accepted = required.accepts[0] as PaymentRequirements;
  return {
    x402Version: 2,
    resource: required.resource,
    accepted,
    payload: {
      transaction: XDR_FIXTURE
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
    assert.equal(required.accepts[0].amount, "10000");
    assert.equal(required.accepts[0].network, "stellar:testnet");
    assert.equal(required.accepts[0].asset, ASSET);
    assert.equal(required.accepts[0].extra.areFeesSponsored, true);
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

test("rejects an EVM-shaped authorization instead of accepting it as Stellar XDR", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/" };
  const payment = await validPayment(body);
  payment.payload = {
    signature: "fixture-signature",
    authorization: { from: "payer", to: "payee", value: "10000" }
  } as unknown as PaymentPayload["payload"];
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(payment) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PAYMENT_HEADER");
    assert.equal(adapter.supportedCalls, 0);
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("rejects payment bound to a different request, amount, or resource", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "es" };
  const payment = await validPayment(body);
  payment.extensions!["website-intelligence/request-binding"].info.requestHash = "sha256:wrong";
  payment.accepted = { ...payment.accepted, amount: "9999" };
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
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    assert.equal(adapter.verifyCalls, 1);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("withholds provider output when settlement fails", async () => {
  const adapter = new FakeFacilitator(undefined, {
    success: false, errorReason: "insufficient_funds", transaction: "", network: "stellar:testnet"
  });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
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
    success: true, transaction: "0xshort", network: "stellar:pubnet", amount: "9999"
  });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
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
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "X402_SETTLEMENT_DISABLED");
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  }, { ...config, settlementEnabled: false });
});

test("rejects a facilitator that does not advertise sponsored Stellar exact support", async () => {
  const adapter = new FakeFacilitator(undefined, undefined, {
    kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:pubnet", extra: { areFeesSponsored: true } }],
    extensions: [], signers: {}
  });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "X402_FACILITATOR_UNSUPPORTED");
    assert.equal(adapter.supportedCalls, 1);
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
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
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.equal(decodeX402Header(response.headers.get("payment-response")!).success, true);
    const result = await response.json();
    assert.equal(result.data.language, "es");
    assert.equal(result.receipt.requestHash, requestHashFor(body));
    assert.equal(result.receipt.payment.amount, "10000");
    assert.equal(result.receipt.payment.network, "stellar:testnet");
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
