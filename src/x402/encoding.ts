const MAX_X402_HEADER_BYTES = 16_384;

export class X402HeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402HeaderError";
  }
}

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402Header<T = any>(encoded: string): T {
  if (!encoded || encoded.length > MAX_X402_HEADER_BYTES) {
    throw new X402HeaderError("x402 header is empty or exceeds 16 KiB");
  }
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload must be an object");
    return parsed as T;
  } catch {
    throw new X402HeaderError("x402 header must contain base64-encoded JSON");
  }
}
