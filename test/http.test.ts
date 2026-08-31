import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { server } from "../src/server.js";
import { serviceCardSha256 } from "../src/x402/canonical.js";

test("serves Service Card and bilingual audits over HTTP", async (context) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const root = await fetch(origin).then((response) => response.json());
  assert.equal(root.service, "website-intelligence");

  const card = await fetch(`${origin}/v1/service-card`).then((response) => response.json());
  assert.equal(card.version, "1.0.0");
  assert.equal(card.schemaVersion, "1.0");
  assert.equal(card.interfaces.http.path, "/v1/x402/audits");
  assert.equal(card.payment.enabled, false);
  assert.equal(card.networkPolicy.default, "deny");
  assert.equal(card.payment.network, "stellar:testnet");
  assert.equal(card.payment.atomicAmount, "10000");
  assert.equal(card.payment.assetDecimals, 7);
  assert.equal(card.payment.binding.route, "/v1/x402/audits");
  assert.equal(card.payment.binding.cardHash, serviceCardSha256(card));

  const response = await fetch(`${origin}/v1/audits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", language: "es" })
  });
  assert.equal(response.status, 200);
  const audit = await response.json();
  assert.equal(audit.language, "es");
  assert.equal(audit.network.attempted, false);
});

test("HTTP audit fails closed for an unknown host", async (context) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/audits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://unknown.invalid" })
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "FIXTURE_NOT_FOUND");
});
