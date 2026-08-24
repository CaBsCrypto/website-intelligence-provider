import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../../../src/http.js";
import { createRuntimeX402Dependencies } from "../../../src/x402/config.js";
import { handlePaidAuditRequest } from "../../../src/x402/provider.js";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this route." } });
    return;
  }
  await handlePaidAuditRequest(request, response, createRuntimeX402Dependencies());
}
