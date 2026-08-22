# Website Intelligence Provider

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

Independent TypeScript API for deterministic website-intelligence audits. It accepts a URL and produces bilingual English or Spanish findings from bundled fixtures.

API TypeScript independiente para auditorías deterministas de inteligencia web. Recibe una URL y genera hallazgos en inglés o español mediante fixtures incluidos.

> **No-network default:** the service never contacts the submitted URL. Unknown hosts fail closed with `FIXTURE_NOT_FOUND`. The audit response records `network.attempted: false` and `network.allowed: false`.
>
> **Red deshabilitada por defecto:** el servicio nunca contacta la URL recibida. Los hosts desconocidos fallan de forma segura con `FIXTURE_NOT_FOUND`.

## Public deployment / Despliegue público

- GitHub: <https://github.com/CaBsCrypto/website-intelligence-provider>
- Stable production deployment: <https://website-intelligence-provider.vercel.app>

The Vercel project is standalone and uses the functions under `api/`. `vercel.json` maps the public routes to those functions. It does not depend on Stellar Bazaar and does not contain Bazaar credentials or deployment hooks.

El proyecto de Vercel es independiente y usa las funciones en `api/`. No depende de Stellar Bazaar ni contiene credenciales o automatizaciones de Bazaar.

## Requirements / Requisitos

- Node.js 22.18 or newer
- npm 10 or newer
- No production runtime dependencies / Sin dependencias de producción

## Local development / Desarrollo local

```sh
npm install
npm test
npm start
```

The server binds to `127.0.0.1:8787` by default. Set `PORT` to override it.

El servidor escucha en `127.0.0.1:8787` por defecto. Usa `PORT` para cambiarlo.

```sh
curl -s http://127.0.0.1:8787/v1/audits \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/","language":"es"}'
```

## HTTP API

| Method | Route | Purpose / Propósito |
|---|---|---|
| `GET` | `/` | Provider identity and endpoint discovery |
| `GET` | `/health` | Health and execution mode |
| `GET` | `/v1/service-card` | Versioned Service Card |
| `GET` | `/v1/fixtures` | Available local fixture identifiers |
| `POST` | `/v1/audits` | Run a deterministic fixture audit |
| `POST` | `/v1/x402/audits` | Run the same audit behind an exact-price x402 Testnet challenge |

Request / Solicitud:

```json
{ "url": "https://example.com/", "language": "es" }
```

`language` is optional and defaults to `en`. Supported values are `en` and `es`.

## x402 Testnet provider slice

The feature branch exposes one payment-protected resource: `POST /v1/x402/audits`. It implements the x402 v2 HTTP transport and returns an actual HTTP `402 Payment Required` with a base64-encoded `PaymentRequired` object in `PAYMENT-REQUIRED`.

La rama de funcionalidad expone un recurso protegido: `POST /v1/x402/audits`. Implementa el transporte HTTP x402 v2 y devuelve un `402 Payment Required` real con `PaymentRequired` codificado en base64 dentro de `PAYMENT-REQUIRED`.

Exact-price contract:

- Scheme: `exact`
- Network: Base Sepolia, CAIP-2 `eip155:84532`
- Asset: Testnet USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Amount: `1000` atomic units (`0.001000` USDC at 6 decimals)
- Settlement: disabled by default
- Recipient: supplied at runtime through `X402_PAY_TO`

The retry request carries the x402 v2 `PaymentPayload` in `PAYMENT-SIGNATURE`. The provider checks protocol version, exact requirements, resource URL, recipient, amount, and a SHA-256 request binding before calling the facilitator adapter. It calls `/verify` before producing a payable result and `/settle` before releasing that result. Settlement failure returns `402` and withholds provider output.

El reintento envía `PaymentPayload` en `PAYMENT-SIGNATURE`. El proveedor valida versión, precio, red, recurso, destinatario, monto y binding SHA-256 antes de invocar el adaptador. Si la liquidación falla, retiene el resultado y devuelve `402`.

Successful responses include:

- x402 `SettlementResponse` in the `PAYMENT-RESPONSE` header;
- the deterministic audit in `data`;
- a provider receipt containing request hash, output hash, exact payment terms, payer and transaction;
- a reconciliation contract that detects receipt or request/output tampering.

### Buyer-harness environment

Copy `.env.example` to the ignored `.env.local` file. `npm start` loads that file automatically on Node.js 22.18+. Required values:

```dotenv
X402_PUBLIC_BASE_URL=http://127.0.0.1:8787
X402_PAY_TO=0xYourBaseSepoliaRecipientAddress
X402_FACILITATOR_URL=https://your-testnet-facilitator.example
X402_SETTLEMENT_ENABLED=false
X402_FACILITATOR_BEARER_TOKEN=
```

`X402_PUBLIC_BASE_URL` must be the externally visible origin used by the buyer. `X402_PAY_TO` must be a 20-byte EVM address controlled by the Testnet recipient. `X402_FACILITATOR_URL` is required only when settlement is enabled and must expose x402 v2 `POST /verify` and `POST /settle`. `X402_FACILITATOR_BEARER_TOKEN` is optional and is sent only to that facilitator.

Keep `X402_SETTLEMENT_ENABLED=false` while running protocol, binding and negative tests. Change it to `true` only for an explicitly authorized Testnet settlement run after `npm run check` passes. The bearer token is optional and must remain only in ignored local environment configuration. No private key is required or accepted by this provider.

Mantén `X402_SETTLEMENT_ENABLED=false` durante las pruebas. Cámbialo a `true` únicamente para una liquidación Testnet autorizada después de superar `npm run check`. No se requiere ni se acepta una clave privada.

## MCP-shaped stdio contract / Contrato MCP por stdio

```sh
npm run mcp
```

The process reads one JSON-RPC message per line. It supports `initialize`, `tools/list`, and `tools/call`. The `audit_website` tool accepts the same `url` and optional `language`, returning both MCP text content and `structuredContent`.

El proceso lee un mensaje JSON-RPC por línea. Admite `initialize`, `tools/list` y `tools/call`. La herramienta `audit_website` usa el mismo input y devuelve texto MCP y `structuredContent`.

## Fixtures and determinism / Fixtures y determinismo

Bundled hosts:

- `example.com`
- `www.example.com`
- `stellar.local`
- `demo.stellar.local`

The same provider version and normalized input always produce the same audit score and findings. Audit output excludes timestamps, DNS state, live HTTP state, environment-derived content, and secrets. The protected endpoint adds an x402 settlement receipt around that deterministic output.

La misma versión e input normalizado siempre generan la misma puntuación y hallazgos. El endpoint protegido agrega un recibo x402 alrededor de esa salida determinista.

## Deploying a separate Vercel project / Desplegar como proyecto separado

With an authenticated Vercel CLI:

```sh
vercel --yes
vercel --prod --yes
```

Vercel builds the TypeScript serverless functions in `api/` using the explicit routes in `vercel.json`. No build directory is committed. `.vercelignore` excludes local caches, work files, build output, credentials, and environment files from deployment uploads.

Vercel detecta automáticamente las funciones TypeScript en `api/`. No se versiona ningún directorio de build.

## Versioning

The HTTP API and output schema use major version `v1` / `1.0`. Breaking response changes require a new route and schema version. [SERVICE_CARD.v1.json](./SERVICE_CARD.v1.json) is verified by tests against the runtime Service Card.

## Security and scope / Seguridad y alcance

- No outbound HTTP client exists in the audit path.
- URL credentials and non-HTTP(S) protocols are rejected.
- Unknown hosts are never fetched.
- No private keys, custody, wallet signing, Mainnet configuration, or payment secrets are stored.
- Facilitator network calls are impossible unless `X402_SETTLEMENT_ENABLED=true` and a facilitator URL is configured.
- `.env`, `.env.*`, build output, caches, and local Vercel metadata are ignored; `.env.example` contains names only.
- This project is independent: it does not publish to or modify Stellar Bazaar or any other provider.

## License

Apache-2.0. See [LICENSE](./LICENSE).
