import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../src/http.js";

export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, {
    service: "website-intelligence",
    version: "1.0.0",
    mode: "fixture",
    networkPolicy: "deny",
    endpoints: ["/health", "/v1/service-card", "/v1/fixtures", "/v1/audits"]
  });
}
