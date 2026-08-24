import test from "node:test";
import assert from "node:assert/strict";
import { handleRpc } from "../src/mcp.js";

test("advertises and calls the MCP-shaped tool", () => {
  const list = handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(list.result.tools[0].name, "audit_website");
  const call = handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "audit_website", arguments: { url: "https://example.com", language: "es" } } });
  assert.equal(call.result.structuredContent.language, "es");
  assert.equal(call.result.structuredContent.mode, "fixture");
});
