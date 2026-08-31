import { canonicalJson, serviceCardSha256 } from "./x402/canonical.js";
import { loadX402Config } from "./x402/config.js";
import type { X402ProviderConfig } from "./x402/types.js";

const serviceCardBase = {
  schemaVersion: "1.0",
  id: "website-intelligence",
  version: "1.0.0",
  name: { en: "Website Intelligence", es: "Inteligencia de Sitios Web" },
  description: {
    en: "Deterministic local-fixture website audit provider.",
    es: "Proveedor de auditoría web determinista mediante fixtures locales."
  },
  input: { contentType: "application/json", schema: { url: "absolute http(s) URL", language: "en | es (optional)" } },
  output: { contentType: "application/json", schemaVersion: "1.0" },
  delivery: { model: "sync" as const },
  capabilities: ["identity", "security", "seo", "accessibility", "performance", "x402-exact-testnet"],
  interfaces: {
    http: { method: "POST", path: "/v1/x402/audits" },
    mcp: { tool: "audit_website" }
  },
  networkPolicy: {
    default: "deny",
    fixtureOnly: true,
    auditOutboundRequests: false,
    facilitatorOutboundRequests: "only-when-X402_SETTLEMENT_ENABLED=true"
  },
  determinism: { guaranteedForSameVersionAndInput: true, clockDataIncluded: false },
  license: "Apache-2.0"
} as const;

export function getServiceCardForConfig(config: X402ProviderConfig) {
  const card = {
    ...serviceCardBase,
    payment: {
      enabled: config.enabled,
      network: config.network,
      scheme: "exact" as const,
      asset: config.asset,
      atomicAmount: config.amount,
      assetDecimals: 7,
      payTo: config.payTo,
      maxTimeoutSeconds: config.maxTimeoutSeconds,
      challengeTtlSeconds: 60,
      binding: {
        method: "POST" as const,
        route: config.endpointPath,
        resourceUrl: new URL(config.endpointPath, `${config.publicBaseUrl.replace(/\/$/, "")}/`).toString(),
        inputHashAlgorithm: "sha256-canonical-json-v1" as const,
        cardHash: ""
      }
    }
  };
  card.payment.binding.cardHash = serviceCardSha256(card);
  return card;
}

export function getServiceCard(env: NodeJS.ProcessEnv = process.env) {
  return getServiceCardForConfig(loadX402Config(env));
}

export const serviceCard = getServiceCard({
  X402_PUBLIC_BASE_URL: "https://invalid.local",
  X402_ALLOWED_PUBLIC_BASE_URLS: "https://invalid.local"
});

export function serviceCardHashFor(env: NodeJS.ProcessEnv = process.env): string {
  return serviceCardSha256(getServiceCard(env));
}

export function serviceCardHashForConfig(config: X402ProviderConfig): string {
  return serviceCardSha256(getServiceCardForConfig(config));
}

export function canonicalServiceCardJson(env: NodeJS.ProcessEnv = process.env): string {
  return canonicalJson(getServiceCard(env));
}
