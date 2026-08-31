import { createInterface } from "node:readline";
import { auditWebsite, AuditInputError } from "./audit.js";

const tool = {
  name: "audit_website",
  description: "Audit a URL using deterministic local fixtures. No network request is performed.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["url"],
    properties: { url: { type: "string", format: "uri" }, language: { type: "string", enum: ["en", "es"] } }
  }
};

export function handleRpc(message: any): any {
  const base = { jsonrpc: "2.0", id: message.id };
  if (message.method === "initialize") return { ...base, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "website-intelligence", version: "1.1.0" } } };
  if (message.method === "notifications/initialized") return undefined;
  if (message.method === "tools/list") return { ...base, result: { tools: [tool] } };
  if (message.method === "tools/call" && message.params?.name === tool.name) {
    try {
      const result = auditWebsite(message.params.arguments ?? {});
      return { ...base, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } };
    } catch (error) {
      const messageText = error instanceof AuditInputError ? error.message : "Invalid tool input";
      return { ...base, result: { content: [{ type: "text", text: messageText }], isError: true } };
    }
  }
  return { ...base, error: { code: -32601, message: "Method not found" } };
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  createInterface({ input: process.stdin }).on("line", (line) => {
    try { const response = handleRpc(JSON.parse(line)); if (response) process.stdout.write(`${JSON.stringify(response)}\n`); }
    catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); }
  });
}
