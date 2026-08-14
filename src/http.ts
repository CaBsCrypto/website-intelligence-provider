import type { IncomingMessage, ServerResponse } from "node:http";
import { auditWebsite, AuditInputError } from "./audit.js";

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

export async function handleAuditRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    sendJson(response, 200, auditWebsite(body));
  } catch (error) {
    if (error instanceof AuditInputError) {
      sendJson(response, error.code === "FIXTURE_NOT_FOUND" ? 404 : 400, { error: { code: error.code, message: error.message } });
      return;
    }
    sendJson(response, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
  }
}
