import test from "node:test";
import assert from "node:assert/strict";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { USDC_TESTNET_ADDRESS, validateStellarDestinationAddress } from "@x402/stellar";
import { DisabledFacilitatorAdapter, FacilitatorAdapterError, HttpFacilitatorAdapter } from "../src/x402/adapter.js";
import { X402_OPENZEPPELIN_TESTNET_FACILITATOR, loadX402Config } from "../src/x402/config.js";
import { paymentRequirementsFor } from "../src/x402/provider.js";
import { getServiceCard } from "../src/service-card.js";
import type { FacilitatorRequest, X402ProviderConfig } from "../src/x402/types.js";

const PAY_TO = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";
const PAYER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TRANSACTION = Buffer.from("signed-stellar-xdr-fixture", "utf8").toString("base64");

const config: X402ProviderConfig = {
  enabled: true,
  settlementEnabled: true,
  executionMode: "manual-single-process",
  configurationErrors: [],
  publicBaseUrl: "https://provider.test",
  endpointPath: "/v1/x402/audits",
  network: "stellar:testnet",
  asset: USDC_TESTNET_ADDRESS,
  payTo: PAY_TO,
  amount: "10000",
  maxTimeoutSeconds: 60
};

const requirements = {
  scheme: "exact" as const,
  network: "stellar:testnet" as const,
  amount: "10000",
  asset: USDC_TESTNET_ADDRESS,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true as const }
};

const facilitatorRequest: FacilitatorRequest = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: TRANSACTION }
  },
  paymentRequirements: requirements
};

test("runtime configuration is Stellar Testnet-only and settlement-off by default", () => {
  const disabled = loadX402Config({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.settlementEnabled, false);
  assert.equal(disabled.network, "stellar:testnet");
  assert.equal(disabled.asset, USDC_TESTNET_ADDRESS);
  assert.equal(disabled.amount, "10000");

  const configured = loadX402Config({ X402_STELLAR_PAY_TO: PAY_TO });
  assert.equal(configured.enabled, false);
  assert.equal(configured.settlementEnabled, false);
  assert.equal(validateStellarDestinationAddress(configured.payTo), true);

  const evmAddress = loadX402Config({ X402_STELLAR_PAY_TO: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" });
  assert.equal(evmAddress.enabled, false);
  assert.equal(X402_OPENZEPPELIN_TESTNET_FACILITATOR, "https://channels.openzeppelin.com/x402/testnet");

  const requestedWithoutKey = loadX402Config({ X402_STELLAR_PAY_TO: PAY_TO, X402_SETTLEMENT_ENABLED: "true" });
  assert.equal(requestedWithoutKey.enabled, false);
  assert.deepEqual(requestedWithoutKey.configurationErrors, [
    "STELLAR_X402_FACILITATOR_API_KEY",
    "X402_PUBLIC_BASE_URL",
    "X402_MANUAL_SINGLE_PROCESS_TESTNET"
  ]);

  const ready = loadX402Config({
    X402_STELLAR_PAY_TO: PAY_TO,
    X402_SETTLEMENT_ENABLED: "true",
    STELLAR_X402_FACILITATOR_API_KEY: "test-only-not-a-real-key",
    X402_PUBLIC_BASE_URL: "https://provider.test/",
    X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
    X402_MANUAL_SINGLE_PROCESS_TESTNET: "true"
  });
  assert.equal(ready.enabled, true);
  assert.equal(ready.settlementEnabled, true);
  assert.equal(ready.publicBaseUrl, "https://provider.test");
  assert.equal(ready.executionMode, "manual-single-process");

  for (const unsafeOrigin of ["http://provider.test", "http://127.0.0.1:8787", "https://provider.test/path", "not-a-url"]) {
    const unsafe = loadX402Config({
      X402_STELLAR_PAY_TO: PAY_TO,
      X402_SETTLEMENT_ENABLED: "true",
      STELLAR_X402_FACILITATOR_API_KEY: "test-only-not-a-real-key",
      X402_PUBLIC_BASE_URL: unsafeOrigin,
      X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
      X402_MANUAL_SINGLE_PROCESS_TESTNET: "true"
    });
    assert.equal(unsafe.settlementEnabled, false);
    assert.equal(unsafe.publicBaseUrl, "https://invalid.local");
  }

  const serverless = loadX402Config({
    X402_STELLAR_PAY_TO: PAY_TO,
    X402_SETTLEMENT_ENABLED: "true",
    STELLAR_X402_FACILITATOR_API_KEY: "test-only-not-a-real-key",
    X402_PUBLIC_BASE_URL: "https://provider.test",
    X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
    X402_MANUAL_SINGLE_PROCESS_TESTNET: "true",
    VERCEL: "1"
  });
  assert.equal(serverless.settlementEnabled, false);
  assert(serverless.configurationErrors.includes("DURABLE_REPLAY_STORE"));

  const durableServerless = loadX402Config({
    X402_STELLAR_PAY_TO: PAY_TO,
    X402_SETTLEMENT_ENABLED: "true",
    STELLAR_X402_FACILITATOR_API_KEY: "test-only-not-a-real-key",
    X402_PUBLIC_BASE_URL: "https://provider.test",
    X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
    VERCEL: "1",
    WEBSITE_INTELLIGENCE_REDIS_REST_URL: "https://durable.example",
    WEBSITE_INTELLIGENCE_REDIS_REST_TOKEN: "test-only-token"
  });
  assert.equal(durableServerless.settlementEnabled, true);
  assert.equal(durableServerless.executionMode, "durable-multi-instance");
});

test("runtime Service Card activates only with complete server configuration and never exposes the key", () => {
  const key = "test-only-sensitive-facilitator-key";
  const inactive = getServiceCard({ X402_STELLAR_PAY_TO: PAY_TO, X402_SETTLEMENT_ENABLED: "true" });
  assert.equal(inactive.payment.enabled, false);

  const active = getServiceCard({
    X402_STELLAR_PAY_TO: PAY_TO,
    X402_SETTLEMENT_ENABLED: "true",
    STELLAR_X402_FACILITATOR_API_KEY: key,
    X402_PUBLIC_BASE_URL: "https://provider.test",
    X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
    X402_MANUAL_SINGLE_PROCESS_TESTNET: "true"
  });
  assert.equal(active.payment.enabled, true);
  assert.equal(active.payment.binding.resourceUrl, "https://provider.test/v1/x402/audits");
  assert.equal(JSON.stringify(active).includes(key), false);
});

test("payment requirements are enhanced through @x402/stellar exact server compatibility", async () => {
  const enhanced = await paymentRequirementsFor(config);
  assert.equal(enhanced.network, "stellar:testnet");
  assert.equal(enhanced.asset, USDC_TESTNET_ADDRESS);
  assert.equal(enhanced.amount, "10000");
  assert.deepEqual(enhanced.extra, { areFeesSponsored: true });
  assert(new ExactStellarScheme() instanceof ExactStellarScheme);
});

test("disabled adapter cannot inspect support, verify, or settle", async () => {
  const adapter = new DisabledFacilitatorAdapter();
  await assert.rejects(adapter.supported(), (error: unknown) =>
    error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED");
  await assert.rejects(adapter.verify(facilitatorRequest), (error: unknown) =>
    error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED");
  await assert.rejects(adapter.settle(facilitatorRequest), (error: unknown) =>
    error instanceof FacilitatorAdapterError && error.code === "SETTLEMENT_DISABLED");
});

test("adapter delegates supported, verify, and settle to the official x402 client boundary", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client = {
    async getSupported() {
      calls.push({ method: "getSupported", args: [] });
      return { kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" as const, extra: { areFeesSponsored: true } }], extensions: [], signers: {} };
    },
    async verify(...args: Parameters<import("@x402/core/server").FacilitatorClient["verify"]>) {
      calls.push({ method: "verify", args });
      return { isValid: true, payer: PAYER };
    },
    async settle(...args: Parameters<import("@x402/core/server").FacilitatorClient["settle"]>) {
      calls.push({ method: "settle", args });
      return { success: true, transaction: "1".repeat(64), network: "stellar:testnet" as const, payer: PAYER };
    }
  };
  const adapter = new HttpFacilitatorAdapter({ baseUrl: "https://facilitator.test/", client });
  assert.equal((await adapter.supported()).kinds[0].network, "stellar:testnet");
  assert.equal((await adapter.verify(facilitatorRequest)).isValid, true);
  assert.equal((await adapter.settle(facilitatorRequest)).success, true);
  assert.deepEqual(calls.map(({ method }) => method), ["getSupported", "verify", "settle"]);
  assert.deepEqual(calls[1].args, [facilitatorRequest.paymentPayload, facilitatorRequest.paymentRequirements]);
  assert.deepEqual(calls[2].args, [facilitatorRequest.paymentPayload, facilitatorRequest.paymentRequirements]);
});
