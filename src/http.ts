import type { IncomingMessage, ServerResponse } from "node:http";
import { auditLiveWebsite } from "./live-audit.js";
import { LiveAuditError } from "./live-fetch.js";
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
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new LiveAuditError("INVALID_INPUT", "Indica una URL válida.");
    const input = body as any;
    if (input.mode === "live" && (process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME)) { sendJson(response, 403, { error: { code: "LIVE_USE_PAID_ENDPOINT", message: "Use the paid live endpoint on hosted deployments." } }); return; }
    if (input.mode !== undefined && !["fixture", "live"].includes(input.mode)) throw new LiveAuditError("INVALID_INPUT", "Modo inválido.");
    sendJson(response, 200, input.mode === "live" ? await auditLiveWebsite(input) : auditWebsite(input));
  } catch (error) {
    if (error instanceof LiveAuditError) {
      sendJson(response, error.code === "TIMEOUT" ? 504 : 422, { error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof AuditInputError) {
      sendJson(response, error.code === "FIXTURE_NOT_FOUND" ? 404 : 400, { error: { code: error.code, message: error.message } });
      return;
    }
    sendJson(response, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
  }
}
