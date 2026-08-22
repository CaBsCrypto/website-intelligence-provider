import { DisabledFacilitatorAdapter, HttpFacilitatorAdapter } from "./adapter.js";
import type { X402Dependencies, X402ProviderConfig } from "./types.js";
import {
  STELLAR_TESTNET_CAIP2,
  USDC_TESTNET_ADDRESS,
  validateStellarDestinationAddress
} from "@x402/stellar";

export const X402_OFFICIAL_TESTNET_FACILITATOR = "https://www.x402.org/facilitator";

export const X402_TESTNET_DEFAULTS = {
  endpointPath: "/v1/x402/audits",
  network: STELLAR_TESTNET_CAIP2,
  asset: USDC_TESTNET_ADDRESS,
  amount: "10000",
  maxTimeoutSeconds: 60
} as const;

export function loadX402Config(env: NodeJS.ProcessEnv = process.env): X402ProviderConfig {
  const payTo = env.X402_STELLAR_PAY_TO ?? "";
  const publicBaseUrl = (env.X402_PUBLIC_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  return {
    ...X402_TESTNET_DEFAULTS,
    enabled: validateStellarDestinationAddress(payTo),
    settlementEnabled: env.X402_SETTLEMENT_ENABLED === "true",
    publicBaseUrl,
    payTo
  };
}

export function createRuntimeX402Dependencies(env: NodeJS.ProcessEnv = process.env): X402Dependencies {
  const config = loadX402Config(env);
  const facilitatorUrl = env.X402_FACILITATOR_URL ?? X402_OFFICIAL_TESTNET_FACILITATOR;
  const facilitator = config.enabled && config.settlementEnabled
    ? new HttpFacilitatorAdapter({ baseUrl: facilitatorUrl, bearerToken: env.X402_FACILITATOR_BEARER_TOKEN })
    : new DisabledFacilitatorAdapter();
  return { config, facilitator };
}
