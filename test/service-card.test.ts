import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serviceCard } from "../src/service-card.js";

test("checked-in and runtime Service Cards stay synchronized", async () => {
  const checkedIn = JSON.parse(await readFile("SERVICE_CARD.v1.json", "utf8"));
  assert.deepEqual(checkedIn, serviceCard);
});

test("Service Card publishes the required synchronous delivery contract", () => {
  assert.equal(serviceCard.delivery.mode, "sync");
  assert.equal(serviceCard.delivery.status.required, false);
  assert.equal(serviceCard.delivery.callback.supported, false);
  assert.equal(serviceCard.delivery.idempotency.key, "Idempotency-Key");
  assert.equal(serviceCard.delivery.result.hash.algorithm, "sha256");
  assert.equal(serviceCard.delivery.result.hash.required, true);
});
