import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../../src/http.js";
import { serviceCard } from "../../src/service-card.js";

export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, serviceCard);
}
