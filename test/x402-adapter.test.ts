import test from "node:test";
import assert from "node:assert/strict";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { USDC_TESTNET_ADDRESS, validateStellarDestinationAddress } from "@x402/stellar";
import { DisabledFacilitatorAdapter, FacilitatorAdapterError, HttpFacilitatorAdapter } from "../src/x402/adapter.js";
import { X402_OPENZEPPELIN_TESTNET_FACILITATOR, loadX402Config } from "../src/x402/config.js";
import { paymentRequirementsFor } from "../src/x402/provider.js";
import type { FacilitatorRequest, X402ProviderConfig } from "../src/x402/types.js";

const PAY_TO = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";
const PAYER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TRANSACTION = Buffer.from("signed-stellar-xdr-fixture", "utf8").toString("base64");

const config: X402ProviderConfig = {
  enabled: true,
  settlementEnabled: true,
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
  assert.equal(configured.enabled, true);
  assert.equal(configured.settlementEnabled, false);
  assert.equal(validateStellarDestinationAddress(configured.payTo), true);

  const evmAddress = loadX402Config({ X402_STELLAR_PAY_TO: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" });
  assert.equal(evmAddress.enabled, false);
  assert.equal(X402_OPENZEPPELIN_TESTNET_FACILITATOR, "https://channels.openzeppelin.com/x402/testnet");
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
