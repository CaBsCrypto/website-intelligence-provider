import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { fixtureIds } from "./fixtures.js";
import { handleAuditRequest, sendJson } from "./http.js";
import { getServiceCard } from "./service-card.js";
import { createRuntimeX402Dependencies } from "./x402/config.js";
import { handlePaidAuditRequest } from "./x402/provider.js";
import { createPaymentReplayStore, createSettlementAttemptGuard } from "./x402/settlement-attempt-guard.js";
import type { X402Dependencies } from "./x402/types.js";

const port = Number(process.env.PORT ?? 8787);

type X402RuntimeState = Pick<X402Dependencies, "paymentReplayStore" | "settlementAttemptGuard">;
type X402DependencyInput = Omit<X402Dependencies, keyof X402RuntimeState> & Partial<X402RuntimeState>;

export function createAppServer(input?: X402DependencyInput) {
  const x402: X402Dependencies = input
    ? {
        ...input,
        settlementAttemptGuard: input.settlementAttemptGuard ?? createSettlementAttemptGuard(),
        paymentReplayStore: input.paymentReplayStore ?? createPaymentReplayStore()
      }
    : createRuntimeX402Dependencies();
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") return sendJson(response, 200, { service: "website-intelligence", version: "2.0.0", mode: "fixture" });
    if (request.method === "GET" && request.url === "/health") return sendJson(response, 200, { status: "ok", mode: "fixture", x402: { enabled: x402.config.enabled, settlementEnabled: x402.config.settlementEnabled, executionMode: x402.config.executionMode } });
    if (request.method === "GET" && request.url === "/v1/service-card") return sendJson(response, 200, getServiceCard());
    if (request.method === "GET" && request.url === "/v1/fixtures") return sendJson(response, 200, { fixtures: fixtureIds() });
    if (request.method === "POST" && request.url === "/v1/audits") return handleAuditRequest(request, response);
    if (request.method === "POST" && request.url === "/v1/x402/audits") return handlePaidAuditRequest(request, response, x402);
    if (request.url === "/v1/x402/audits") {
      response.setHeader("allow", "POST");
      return sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for this route." } });
    }
    return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
  });
}

export const server = createAppServer();

// `file://${path}` breaks on Windows (`file://C:/...`). Use Node's URL helper so
// the standalone provider starts consistently on the development host as well.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, "127.0.0.1", () => console.log(`website-intelligence listening on http://127.0.0.1:${port}`));
}
