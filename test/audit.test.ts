import test from "node:test";
import assert from "node:assert/strict";
import { auditWebsite, AuditInputError } from "../src/audit.js";

test("returns deterministic English output without network", () => {
  const first = auditWebsite({ url: "https://example.com/" });
  const second = auditWebsite({ url: "https://example.com/" });
  assert.deepEqual(first, second);
  assert.equal(first.score, 88);
  assert.deepEqual(first.network, { attempted: false, allowed: false });
});

test("localizes human-readable output to Spanish", () => {
  const result = auditWebsite({ url: "https://stellar.local/page", language: "es" });
  assert.match(result.summary, /Auditoría local/);
  assert.equal(result.findings[1].title, "Falta el idioma del documento");
});

test("rejects unknown hosts instead of accessing the network", () => {
  assert.throws(() => auditWebsite({ url: "https://not-a-fixture.invalid" }), (error: unknown) => error instanceof AuditInputError && error.code === "FIXTURE_NOT_FOUND");
});

test("rejects unsafe or malformed URLs", () => {
  assert.throws(() => auditWebsite({ url: "file:///etc/passwd" }), AuditInputError);
  assert.throws(() => auditWebsite({ url: "not a url" }), AuditInputError);
});
