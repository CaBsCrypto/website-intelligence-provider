import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../../../../src/http.js";
import { createRuntimeX402Dependencies } from "../../../../src/x402/config.js";
import { handleDeliveryRecovery } from "../../../../src/x402/recovery.js";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for recovery." } });
    return;
  }
  await handleDeliveryRecovery(request, response, createRuntimeX402Dependencies());
}
