import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serviceCard } from "../src/service-card.js";

test("checked-in and runtime Service Cards stay synchronized", async () => {
  const checkedIn = JSON.parse(await readFile("SERVICE_CARD.v1.json", "utf8"));
  assert.deepEqual(checkedIn, serviceCard);
});
