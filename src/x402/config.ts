import { DisabledFacilitatorAdapter, HttpFacilitatorAdapter } from "./adapter.js";
import type { X402Dependencies, X402ProviderConfig } from "./types.js";
import { processPaymentReplayStore, processSettlementAttemptGuard } from "./settlement-attempt-guard.js";
import { StellarSettlementEvidenceVerifier } from "./stellar-settlement-evidence.js";
import { UpstashPaymentStore } from "./upstash-payment-store.js";
import {
  STELLAR_TESTNET_CAIP2,
  USDC_TESTNET_ADDRESS,
  validateStellarDestinationAddress
} from "@x402/stellar";

/**
 * OpenZeppelin Channels is the facilitator selected for the Stellar Testnet
 * pilot. It requires an API key at runtime; settlement stays disabled unless
 * both a valid recipient and the explicit flag are supplied.
 */
export const X402_OPENZEPPELIN_TESTNET_FACILITATOR = "https://channels.openzeppelin.com/x402/testnet";

export const X402_TESTNET_DEFAULTS = {
  endpointPath: "/v1/x402/audits",
  network: STELLAR_TESTNET_CAIP2,
  asset: USDC_TESTNET_ADDRESS,
  amount: "10000",
  maxTimeoutSeconds: 60
} as const;

function canonicalHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function allowedOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => canonicalHttpsOrigin(item.trim())).filter((item): item is string => Boolean(item)));
}

export function loadX402Config(env: NodeJS.ProcessEnv = process.env): X402ProviderConfig {
  const payTo = env.X402_STELLAR_PAY_TO ?? "";
  const requestedPublicOrigin = canonicalHttpsOrigin(env.X402_PUBLIC_BASE_URL);
  const publicOriginAllowlist = allowedOrigins(env.X402_ALLOWED_PUBLIC_BASE_URLS);
  const facilitatorApiKey = env.STELLAR_X402_FACILITATOR_API_KEY ?? "";
  const settlementRequested = env.X402_SETTLEMENT_ENABLED === "true";
  const manualSingleProcess = env.X402_MANUAL_SINGLE_PROCESS_TESTNET === "true";
  const multiInstanceRuntime = env.VERCEL === "1" || env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
  const durableStoreUrl = env.WEBSITE_INTELLIGENCE_REDIS_REST_URL ?? "";
  const durableStoreToken = env.WEBSITE_INTELLIGENCE_REDIS_REST_TOKEN ?? "";
  const durableStoreConfigured = /^https:\/\//.test(durableStoreUrl) && durableStoreToken.length > 0;
  const configurationErrors = [
    ...(validateStellarDestinationAddress(payTo) ? [] : ["X402_STELLAR_PAY_TO"]),
    ...(settlementRequested && !facilitatorApiKey ? ["STELLAR_X402_FACILITATOR_API_KEY"] : []),
    ...(settlementRequested && !requestedPublicOrigin ? ["X402_PUBLIC_BASE_URL"] : []),
    ...(settlementRequested && requestedPublicOrigin && !publicOriginAllowlist.has(requestedPublicOrigin) ? ["X402_ALLOWED_PUBLIC_BASE_URLS"] : []),
    ...(settlementRequested && !multiInstanceRuntime && !manualSingleProcess ? ["X402_MANUAL_SINGLE_PROCESS_TESTNET"] : []),
    ...(settlementRequested && multiInstanceRuntime && !durableStoreConfigured ? ["DURABLE_REPLAY_STORE"] : [])
  ];
  const settlementEnabled = settlementRequested && configurationErrors.length === 0;
  return {
    ...X402_TESTNET_DEFAULTS,
    enabled: settlementEnabled,
    settlementEnabled,
    executionMode: settlementEnabled ? (multiInstanceRuntime ? "durable-multi-instance" : "manual-single-process") : "disabled",
    configurationErrors,
    publicBaseUrl: requestedPublicOrigin ?? "https://invalid.local",
    payTo
  };
}

export function createRuntimeX402Dependencies(env: NodeJS.ProcessEnv = process.env): X402Dependencies {
  const config = loadX402Config(env);
  const facilitatorUrl = env.STELLAR_X402_FACILITATOR_URL ?? X402_OPENZEPPELIN_TESTNET_FACILITATOR;
  const facilitatorApiKey = env.STELLAR_X402_FACILITATOR_API_KEY;
  const facilitator = config.enabled && config.settlementEnabled
    ? new HttpFacilitatorAdapter({ baseUrl: facilitatorUrl, bearerToken: facilitatorApiKey })
    : new DisabledFacilitatorAdapter();
  return {
    config,
    facilitator,
    settlementEvidenceVerifier: new StellarSettlementEvidenceVerifier(),
    settlementAttemptGuard: processSettlementAttemptGuard,
    paymentReplayStore: config.executionMode === "durable-multi-instance"
      ? new UpstashPaymentStore(env.WEBSITE_INTELLIGENCE_REDIS_REST_URL!, env.WEBSITE_INTELLIGENCE_REDIS_REST_TOKEN!)
      : processPaymentReplayStore
  };
}
