import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function serviceCardSha256(card: unknown): string {
  const copy = structuredClone(card);
  if (copy && typeof copy === "object") {
    const payment = (copy as Record<string, unknown>).payment;
    if (payment && typeof payment === "object") {
      const binding = (payment as Record<string, unknown>).binding;
      if (binding && typeof binding === "object") delete (binding as Record<string, unknown>).cardHash;
    }
  }
  return sha256(copy);
}
