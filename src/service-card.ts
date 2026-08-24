export const serviceCard = {
  schemaVersion: "1.0",
  id: "website-intelligence",
  version: "1.1.0",
  name: { en: "Website Intelligence", es: "Inteligencia de Sitios Web" },
  description: {
    en: "Deterministic local-fixture website audit provider.",
    es: "Proveedor de auditoría web determinista mediante fixtures locales."
  },
  input: { contentType: "application/json", schema: { url: "absolute http(s) URL", language: "en | es (optional)" } },
  output: { contentType: "application/json", schemaVersion: "1.0" },
  delivery: {
    mode: "sync",
    estimatedDurationMs: 500,
    result: {
      schemaVersion: "1.0",
      contentType: "application/json",
      terminalStatuses: ["completed", "failed"],
      hash: { algorithm: "sha256", required: true, scope: "canonical-result" }
    },
    status: { required: false },
    callback: { supported: false, required: false, authentication: "none" },
    retention: { resultTtlHours: 0, durable: false },
    idempotency: { required: true, key: "Idempotency-Key", replay: "return-original" },
    retry: { retryable: true, maxAttempts: 2, failureSemantics: "retry-later" }
  },
  capabilities: ["identity", "security", "seo", "accessibility", "performance", "x402-exact-testnet"],
  interfaces: {
    http: { method: "POST", path: "/v1/audits" },
    paidHttp: { method: "POST", path: "/v1/x402/audits" },
    mcp: { tool: "audit_website" }
  },
  payments: {
    protocol: "x402",
    x402Version: 2,
    environment: "testnet",
    settlementDefault: "disabled",
    protectedResources: [{
      method: "POST",
      path: "/v1/x402/audits",
      scheme: "exact",
      network: "stellar:testnet",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "10000",
      assetDecimals: 7,
      payTo: { source: "environment", variable: "X402_STELLAR_PAY_TO", formats: ["G-address", "C-address"] },
      extra: { areFeesSponsored: true },
      payload: { transaction: "base64 Soroban transaction XDR with signed auth entries" },
      compatibility: { package: "@x402/stellar", version: "2.23.0", scheme: "ExactStellarScheme" },
      facilitator: { defaultUrl: "https://www.x402.org/facilitator", requiredCapability: "x402-v2 exact stellar:testnet sponsored" },
      requestBinding: { algorithm: "sha256", extension: "website-intelligence/request-binding" },
      receiptSchemaVersion: "1.0"
    }]
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
