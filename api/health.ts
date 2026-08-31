import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../src/http.js";
import { loadX402Config } from "../src/x402/config.js";

export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  const x402 = loadX402Config();
  sendJson(response, 200, {
    status: "ok",
    mode: "fixture",
    x402: {
      enabled: x402.enabled,
      network: x402.network,
      executionMode: x402.executionMode,
      durableStateRequired: process.env.VERCEL === "1"
    }
  });
}
