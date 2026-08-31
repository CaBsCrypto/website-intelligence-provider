import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../../src/http.js";
import { getServiceCard } from "../../src/service-card.js";

export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, getServiceCard());
}
