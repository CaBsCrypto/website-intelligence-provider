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

## x402 Stellar Testnet provider slice

The feature branch exposes one payment-protected resource: `POST /v1/x402/audits`. It implements the x402 v2 HTTP transport and returns an actual HTTP `402 Payment Required` with a base64-encoded `PaymentRequired` object in `PAYMENT-REQUIRED`.

La rama de funcionalidad expone un recurso protegido: `POST /v1/x402/audits`. Implementa el transporte HTTP x402 v2 y devuelve un `402 Payment Required` real con `PaymentRequired` codificado en base64 dentro de `PAYMENT-REQUIRED`.

Exact-price contract:

- Scheme: `exact`
- Network: Stellar Testnet, CAIP-2 `stellar:testnet`
- Asset: SEP-41 Testnet USDC contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Amount: `10000` atomic units (`0.0010000` USDC at 7 decimals)
- Fees: facilitator-sponsored, advertised as `extra.areFeesSponsored: true`
- SDK compatibility: pinned Apache-2.0 `@x402/core@2.24.0` and `@x402/stellar@2.24.0`, using `ExactStellarScheme`
- Settlement: disabled by default
- Recipient: Stellar G- or C-address supplied through `X402_STELLAR_PAY_TO`

The retry request carries an x402 v2 Stellar `PaymentPayload` in `PAYMENT-SIGNATURE`; its `payload.transaction` is the base64 transaction XDR containing the signed Soroban authorization entries. The provider validates protocol version, exact Stellar requirements, resource URL, method, route, canonical input hash, and Service Card hash before crossing the facilitator boundary. With settlement enabled it first checks `/supported` for sponsored `exact` support on `stellar:testnet`, then calls `/verify` and `/settle`. Settlement failure returns `402` and withholds provider output.

Replay protection supports two explicit modes. The authorized local validation profile uses one process-local reservation. A Vercel/multi-instance runtime requires a dedicated Upstash-compatible Redis REST store and uses atomic `SET NX` reservations plus an atomic Lua commit for the delivery envelope and receipt. Missing or unavailable durable storage fails closed before settlement. The public paid endpoint remains inactive until dedicated provider storage is provisioned, configured and validated; Bazaar storage credentials must not be reused.

El reintento envía `PaymentPayload` en `PAYMENT-SIGNATURE`. El proveedor valida versión, requisitos exactos de Stellar, recurso y binding SHA-256 antes de invocar el adaptador; el facilitador valida en el XDR firmado el activo, destinatario, monto y autorizaciones Soroban. Si la liquidación falla, retiene el resultado y devuelve `402`.

Successful responses include:

- x402 `SettlementResponse` in the `PAYMENT-RESPONSE` header;
- the deterministic audit in `data`;
- a provider receipt containing request hash, output hash, exact payment terms, payer and transaction;
- a reconciliation contract that detects receipt or request/output tampering.

### Buyer-harness environment

Copy `.env.example` to the ignored `.env.local` file. `npm start` loads that file automatically on Node.js 22.18+. Required values:

```dotenv
X402_PUBLIC_BASE_URL=https://provider.example
X402_ALLOWED_PUBLIC_BASE_URLS=https://provider.example
X402_STELLAR_PAY_TO=GYourStellarTestnetRecipientAddress
STELLAR_X402_FACILITATOR_URL=https://channels.openzeppelin.com/x402/testnet
X402_SETTLEMENT_ENABLED=false
X402_MANUAL_SINGLE_PROCESS_TESTNET=false
STELLAR_X402_FACILITATOR_API_KEY=
```

`X402_PUBLIC_BASE_URL` must be an explicit canonical HTTPS origin and must also appear exactly in `X402_ALLOWED_PUBLIC_BASE_URLS`; localhost, HTTP, credentials, paths, queries and fragments fail closed. `X402_STELLAR_PAY_TO` must be a valid Stellar G- or C-address controlled by the Testnet recipient and able to receive the configured USDC asset. The default facilitator is OpenZeppelin Channels for Stellar Testnet; it requires `STELLAR_X402_FACILITATOR_API_KEY` as a server-only secret for its `supported`, `verify`, and `settle` calls. On Vercel, `WEBSITE_INTELLIGENCE_REDIS_REST_URL` and `WEBSITE_INTELLIGENCE_REDIS_REST_TOKEN` are additionally required. The dynamic Service Card keeps `payment.enabled: false` until the applicable profile is complete. No `NEXT_PUBLIC` or browser-visible variable is used.

`X402_MANUAL_SINGLE_PROCESS_TESTNET=true` is only for an explicitly authorized local Testnet E2E in one controlled Node process. It never enables a Vercel/Lambda runtime. Multi-instance settlement requires the dedicated durable variables instead.

### Verified Testnet evidence / Evidencia verificada

The first reconciled external-provider purchase completed on Stellar Testnet for exactly `0.001 USDC` (`10000` atomic units). Transaction [`48d2a2cc92b9433cca611c778b605c759613278c074557ffc6f7c57307d9356f`](https://stellar.expert/explorer/testnet/tx/48d2a2cc92b9433cca611c778b605c759613278c074557ffc6f7c57307d9356f), ledger `4416660`, transferred from the shortened test payer `GCHU7I…MHQQRW` to the shortened test seller `GAHOZF…J3WCSM`. The provider returned the deterministic result only after reconciling the transaction operation, SAC asset, payer, recipient, amount and ledger. This is Testnet POC evidence, not Mainnet, production readiness or an audit claim.

La primera compra reconciliada se completó en Stellar Testnet por `0.001 USDC`. El resultado se entregó únicamente después de reconciliar la evidencia on-chain. Es evidencia de POC en Testnet, no una afirmación de producción, Mainnet o auditoría.

The buyer harness—not this provider—must use `@x402/stellar` client support and a Stellar Testnet signer capable of signing Soroban authorization entries. It must preserve the `website-intelligence/request-binding` extension from the challenge in its `PaymentPayload`. Provider configuration never accepts a Stellar secret key.

Keep `X402_SETTLEMENT_ENABLED=false` while running protocol, binding and negative tests. Change it to `true` only for an explicitly authorized Testnet settlement run after `npm run check` passes. The API key must remain only in ignored local environment configuration. No private key is required or accepted by this provider.

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

The HTTP API, Service Card and output schema use major version `v1` / `1.0`. [SERVICE_CARD.v2.json](./SERVICE_CARD.v2.json) is a checked-in fail-closed snapshot kept synchronized with the dynamic runtime card; despite its historical filename, its content follows the canonical v1 contract. [SERVICE_CARD.v1.json](./SERVICE_CARD.v1.json) remains historical evidence.

## Security and scope / Seguridad y alcance

- No outbound HTTP client exists in the audit path.
- URL credentials and non-HTTP(S) protocols are rejected.
- Unknown hosts are never fetched.
- No private keys, custody, wallet signing, Mainnet configuration, or payment secrets are stored.
- Facilitator network calls are impossible unless `X402_SETTLEMENT_ENABLED=true` and `X402_STELLAR_PAY_TO` is valid.
- Payment activation additionally requires the server-only OpenZeppelin Channels API key; missing configuration fails closed without naming or echoing secret values.
- Successful receipts bind request/output, network, asset, amount, payTo and transaction. The provider independently reads the confirmed Stellar transaction, requires a positive ledger and withholds delivery when the on-chain operation does not reconcile.
- `.env`, `.env.*`, build output, caches, and local Vercel metadata are ignored; `.env.example` contains names only.
- This project is independent: it does not publish to or modify Stellar Bazaar or any other provider.

## License

Apache-2.0. See [LICENSE](./LICENSE).
