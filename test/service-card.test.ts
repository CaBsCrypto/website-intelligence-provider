import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getServiceCard, serviceCard } from "../src/service-card.js";
import { serviceCardSha256 } from "../src/x402/canonical.js";

const PAY_TO = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";

test("checked-in and runtime Service Cards stay synchronized", async () => {
  const checkedIn = JSON.parse(await readFile("SERVICE_CARD.v2.json", "utf8"));
  assert.deepEqual(checkedIn, serviceCard);
});

test("dynamic Service Card declares its exact canonical hash", () => {
  const card = getServiceCard({
    X402_STELLAR_PAY_TO: PAY_TO,
    X402_SETTLEMENT_ENABLED: "true",
    STELLAR_X402_FACILITATOR_API_KEY: "test-only-not-a-real-key",
    X402_PUBLIC_BASE_URL: "https://provider.test",
    X402_ALLOWED_PUBLIC_BASE_URLS: "https://provider.test",
    X402_MANUAL_SINGLE_PROCESS_TESTNET: "true"
  });
  assert.equal(card.payment.enabled, true);
  assert.equal(card.payment.binding.cardHash, serviceCardSha256(card));
  assert.equal(card.payment.binding.resourceUrl, "https://provider.test/v1/x402/audits");
});
