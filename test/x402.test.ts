import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../src/server.js";
import { encodeX402Header, decodeX402Header } from "../src/x402/encoding.js";
import { createPaymentRequired, requestHashFor } from "../src/x402/provider.js";
import { reconcileReceipt } from "../src/x402/receipt.js";
import { recoveryProofForToken, RECOVERY_VERSION } from "../src/x402/recovery.js";
import { createPaymentReplayStore } from "../src/x402/settlement-attempt-guard.js";
import type {
  FacilitatorAdapter,
  PaymentPayload,
  PaymentRequirements,
  SettlementResponse,
  SettlementEvidenceVerifier,
  PaymentReplayStore,
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
  executionMode: "disabled",
  configurationErrors: [],
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
      amount: "10000",
      ledger: 123456
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
  serverConfig: X402ProviderConfig = config,
  settlementEvidenceVerifier?: SettlementEvidenceVerifier,
  paymentReplayStore?: PaymentReplayStore
): Promise<void> {
  const server = createAppServer({ config: serverConfig, facilitator: adapter, settlementEvidenceVerifier, paymentReplayStore });
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

test("fails closed before settlement when durable reservation is unavailable", async () => {
  const adapter = new FakeFacilitator();
  const unavailable: PaymentReplayStore = {
    async reserve() { throw new Error("offline"); },
    async release() {},
    async getDelivery() { return null; },
    async commitDelivery() {},
    async getRecovery() { return null; },
    async reserveRecoveryIntent() { throw new Error("offline"); },
    async getRecoveryIntent() { throw new Error("offline"); }
  };
  const body = { url: "https://example.com/", language: "es" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DURABLE_STORE_UNAVAILABLE");
    assert.equal(adapter.settleCalls, 0);
  }, config, undefined, unavailable);
});

test("withholds delivery when on-chain settlement evidence does not reconcile", async () => {
  const adapter = new FakeFacilitator();
  const verifier: SettlementEvidenceVerifier = {
    async reconcile() { throw new Error("SETTLEMENT_RECIPIENT_OR_AMOUNT_MISMATCH"); }
  };
  const body = { url: "https://example.com/", language: "es" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "SETTLEMENT_EVIDENCE_MISMATCH");
    assert.equal(adapter.settleCalls, 1);
  }, config, verifier);
});

test("uses reconciled ledger evidence before returning the paid result", async () => {
  const transaction = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const adapter = new FakeFacilitator({ isValid: true, payer: PAYER }, {
    success: true, payer: PAYER, transaction, network: "stellar:testnet", amount: "10000"
  });
  const verifier: SettlementEvidenceVerifier = {
    async reconcile(_request, settlement) { return { ...settlement, ledger: 654321, payer: PAYER, amount: "10000" }; }
  };
  const body = { url: "https://example.com/", language: "es" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).receipt.ledger, 654321);
  }, config, verifier);
});

async function validPayment(body: object, overrides: Partial<PaymentPayload> = {}, recovery?: { requestId: string; proof: string }): Promise<PaymentPayload> {
  const required = await createPaymentRequired(config, body, "PAYMENT-SIGNATURE header is required", recovery);
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
    const binding = required.extensions["website-intelligence/request-binding"].info;
    assert.equal(binding.inputHash, requestHashFor(body));
    assert.equal(binding.method, "POST");
    assert.equal(binding.route, "/v1/x402/audits");
    assert.match(String(binding.cardHash), /^[a-f0-9]{64}$/);
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
  payment.extensions!["website-intelligence/request-binding"].info.inputHash = "sha256:wrong";
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
  }, { ...config, enabled: false, payTo: "", configurationErrors: ["X402_STELLAR_PAY_TO"] });
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
    assert.equal(result.result.language, "es");
    assert.equal(result.resultHash, requestHashFor(result.result));
    assert.equal(result.receipt.inputHash, requestHashFor(body));
    assert.equal(result.receipt.resultHash, result.resultHash);
    assert.equal(result.receipt.amount, "10000");
    assert.equal(result.receipt.network, "stellar:testnet");
    assert.equal(adapter.verifyCalls, 1);
    assert.equal(adapter.settleCalls, 1);
    assert.deepEqual(reconcileReceipt(result.receipt, {
      request: body,
      output: result.result,
      network: config.network,
      amount: config.amount,
      asset: config.asset,
      payTo: config.payTo,
      transaction: result.receipt.transactionHash,
      ledger: result.receipt.ledger
    }), { matched: true, mismatches: [] });

    const tampered = reconcileReceipt(result.receipt, { request: { ...body, language: "en" }, output: result.result });
    assert.equal(tampered.matched, false);
    assert(tampered.mismatches.includes("inputHash"));
    assert.equal(reconcileReceipt(result.receipt, { output: { ...result.result, score: 0 } }).matched, false);
  });
});

test("returns the committed delivery for an idempotent replay without settling twice", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "en" };
  const header = encodeX402Header(await validPayment(body));
  await withServer(adapter, async (origin) => {
    const request = () => fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": header },
      body: JSON.stringify(body)
    });
    const first = await request();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const replay = await request();
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.receipt.transactionHash, firstBody.receipt.transactionHash);
    assert.equal(replayBody.resultHash, firstBody.resultHash);
    assert.equal(adapter.settleCalls, 1);
  });
});

test("recovers a durable delivery with a buyer-owned capability without settling twice", async () => {
  const adapter = new FakeFacilitator();
  const baseStore = createPaymentReplayStore();
  let recoveryMode: "normal" | "invalid-date" | "expired" | "tampered-result" = "normal";
  const store: PaymentReplayStore = { ...baseStore, async getRecovery(id) { const record = await baseStore.getRecovery(id); if (!record) return null; const copy = structuredClone(record); if (recoveryMode === "invalid-date") copy.recovery!.expiresAt = "invalid"; if (recoveryMode === "expired") copy.recovery!.expiresAt = "2000-01-01T00:00:00.000Z"; if (recoveryMode === "tampered-result") copy.result = { changed: true }; return copy; } };
  const body = { url: "https://example.com/", language: "es" };
  const token = "A".repeat(43);
  const requestId = "b".repeat(32);
  const proof = recoveryProofForToken(token);
  const signature = encodeX402Header(await validPayment(body, {}, { requestId, proof }));
  await withServer(adapter, async (origin) => {
    const challenge = await fetch(`${origin}${config.endpointPath}`, { method: "POST", headers: { "content-type": "application/json", "x-bazaar-request-id": requestId, "x-bazaar-recovery-proof": proof }, body: JSON.stringify(body) });
    assert.equal(challenge.status, 402);
    const paid = await fetch(`${origin}${config.endpointPath}`, { method: "POST", headers: { "content-type": "application/json", "payment-signature": signature, "x-bazaar-request-id": requestId, "x-bazaar-recovery-proof": proof }, body: JSON.stringify(body) });
    assert.equal(paid.status, 200);
    const delivered = await paid.json();
    assert.equal(delivered.recovery.available, true);
    const recover = (recoveryToken: string, requestedId = requestId) => fetch(`${origin}/v1/x402/audits/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: RECOVERY_VERSION, recoveryId: delivered.recovery.recoveryId, requestId: requestedId, recoveryToken }) });
    const wrong = await recover("B".repeat(43));
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).error.code, "RECOVERY_UNAUTHORIZED");
    assert.equal((await recover(token, "c".repeat(32))).status, 403);
    const recovered = await recover(token);
    assert.equal(recovered.status, 200);
    const recoveredBody = await recovered.json();
    assert.deepEqual(recoveredBody.result, delivered.result);
    assert.equal(recoveredBody.resultHash, delivered.resultHash);
    assert.equal(recoveredBody.receipt.transactionHash, delivered.receipt.transactionHash);
    assert.equal((await recover(token)).status, 200, "terminal recovery remains idempotent");
    recoveryMode = "invalid-date"; assert.equal((await recover(token)).status, 422);
    recoveryMode = "expired"; assert.equal((await recover(token)).status, 410);
    recoveryMode = "tampered-result"; assert.equal((await recover(token)).status, 422);
    assert.equal(adapter.settleCalls, 1);
  }, config, undefined, store);
});

test("recovery fails closed for missing or unavailable durable records", async () => {
  const body = { version: RECOVERY_VERSION, recoveryId: "a".repeat(64), requestId: "b".repeat(32), recoveryToken: "C".repeat(43) };
  const adapter = new FakeFacilitator();
  await withServer(adapter, async (origin) => {
    const missing = await fetch(`${origin}/v1/x402/audits/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(missing.status, 404);
  });
  const base = createPaymentReplayStore();
  const unavailable: PaymentReplayStore = { ...base, async getRecovery() { throw new Error("offline"); } };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}/v1/x402/audits/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 503);
  }, config, undefined, unavailable);
  assert.equal(adapter.settleCalls, 0);
});

test("rejects malformed recovery binding before facilitator verification or settlement", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "es" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, { method: "POST", headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)), "x-bazaar-request-id": "bad", "x-bazaar-recovery-proof": "also-bad" }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "RECOVERY_BINDING_INVALID");
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("binds recovery proof into the x402 challenge and rejects a changed proof", async () => {
  const adapter = new FakeFacilitator();
  const body = { url: "https://example.com/", language: "es" };
  const requestId = "a".repeat(32);
  const proof = "b".repeat(64);
  const signature = encodeX402Header(await validPayment(body, {}, { requestId, proof }));
  await withServer(adapter, async (origin) => {
    const challenge = await fetch(`${origin}${config.endpointPath}`, { method: "POST", headers: { "content-type": "application/json", "x-bazaar-request-id": requestId, "x-bazaar-recovery-proof": proof }, body: JSON.stringify(body) });
    assert.equal(challenge.status, 402);
    const tamperedPayment = decodeX402Header<PaymentPayload>(signature);
    tamperedPayment.extensions!["website-intelligence/request-binding"].info.recoveryProof = "c".repeat(64);
    const response = await fetch(`${origin}${config.endpointPath}`, { method: "POST", headers: { "content-type": "application/json", "payment-signature": encodeX402Header(tamperedPayment), "x-bazaar-request-id": requestId, "x-bazaar-recovery-proof": "c".repeat(64) }, body: JSON.stringify(body) });
    assert.equal(response.status, 409);
    assert.equal(adapter.verifyCalls, 0);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("expired authorization fails verification and never settles", async () => {
  const adapter = new FakeFacilitator({ isValid: false, invalidReason: "authorization_expired" });
  const body = { url: "https://example.com/" };
  await withServer(adapter, async (origin) => {
    const response = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(body)) },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 402);
    assert.match((await response.json()).error, /expired/);
    assert.equal(adapter.settleCalls, 0);
  });
});

test("manual Testnet runtime consumes at most one settlement attempt per process", async () => {
  const adapter = new FakeFacilitator();
  const oneShotConfig = { ...config, executionMode: "manual-single-process" as const };
  await withServer(adapter, async (origin) => {
    const firstBody = { url: "https://example.com/", language: "en" };
    const first = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(firstBody)) },
      body: JSON.stringify(firstBody)
    });
    assert.equal(first.status, 200);

    const secondBody = { url: "https://example.com/", language: "es" };
    const second = await fetch(`${origin}${config.endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": encodeX402Header(await validPayment(secondBody)) },
      body: JSON.stringify(secondBody)
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, "MANUAL_TESTNET_ATTEMPT_CONSUMED");
    assert.equal(adapter.settleCalls, 1);
  }, oneShotConfig);
});
