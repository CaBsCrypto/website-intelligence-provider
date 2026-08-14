import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAuditRequest } from "../../src/http.js";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this route." } }));
    return;
  }
  await handleAuditRequest(request, response);
}
