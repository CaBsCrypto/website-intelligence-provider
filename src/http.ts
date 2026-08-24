import type { IncomingMessage, ServerResponse } from "node:http";
import { auditWebsite, AuditInputError } from "./audit.js";

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function handleAuditRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(request);
    sendJson(response, 200, auditWebsite(body as any));
  } catch (error) {
    if (error instanceof AuditInputError) {
      sendJson(response, error.code === "FIXTURE_NOT_FOUND" ? 404 : 400, { error: { code: error.code, message: error.message } });
      return;
    }
    sendJson(response, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
  }
}
