import type { IncomingMessage, ServerResponse } from "node:http";
import { fixtureIds } from "../../src/fixtures.js";
import { sendJson } from "../../src/http.js";

export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 200, { fixtures: fixtureIds() });
}
