import { DisabledFacilitatorAdapter, HttpFacilitatorAdapter } from "./adapter.js";
import type { X402Dependencies, X402ProviderConfig } from "./types.js";

export const X402_TESTNET_DEFAULTS = {
  endpointPath: "/v1/x402/audits",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "1000",
  maxTimeoutSeconds: 60
} as const;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function loadX402Config(env: NodeJS.ProcessEnv = process.env): X402ProviderConfig {
  const payTo = env.X402_PAY_TO ?? "";
  const publicBaseUrl = (env.X402_PUBLIC_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  return {
    ...X402_TESTNET_DEFAULTS,
    enabled: EVM_ADDRESS.test(payTo),
    settlementEnabled: env.X402_SETTLEMENT_ENABLED === "true",
    publicBaseUrl,
    payTo
  };
}

export function createRuntimeX402Dependencies(env: NodeJS.ProcessEnv = process.env): X402Dependencies {
  const config = loadX402Config(env);
  const facilitatorUrl = env.X402_FACILITATOR_URL;
  const facilitator = config.enabled && config.settlementEnabled && facilitatorUrl
    ? new HttpFacilitatorAdapter({ baseUrl: facilitatorUrl, bearerToken: env.X402_FACILITATOR_BEARER_TOKEN })
    : new DisabledFacilitatorAdapter();
  return { config, facilitator };
}
