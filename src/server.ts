import { createServer } from "node:http";
import { fixtureIds } from "./fixtures.js";
import { handleAuditRequest, sendJson } from "./http.js";
import { serviceCard } from "./service-card.js";

const port = Number(process.env.PORT ?? 8787);

export const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") return sendJson(response, 200, { service: "website-intelligence", version: "1.0.0", mode: "fixture" });
  if (request.method === "GET" && request.url === "/health") return sendJson(response, 200, { status: "ok", mode: "fixture" });
  if (request.method === "GET" && request.url === "/v1/service-card") return sendJson(response, 200, serviceCard);
  if (request.method === "GET" && request.url === "/v1/fixtures") return sendJson(response, 200, { fixtures: fixtureIds() });
  if (request.method === "POST" && request.url === "/v1/audits") return handleAuditRequest(request, response);
  return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
});

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  server.listen(port, "127.0.0.1", () => console.log(`website-intelligence listening on http://127.0.0.1:${port}`));
}
