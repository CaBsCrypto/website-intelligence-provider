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

Request / Solicitud:

```json
{ "url": "https://example.com/", "language": "es" }
```

`language` is optional and defaults to `en`. Supported values are `en` and `es`.

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

The same provider version and normalized input always produce the same score and findings. Output excludes timestamps, DNS state, live HTTP state, environment-derived content, secrets, wallets, and payment data.

La misma versión e input normalizado siempre generan la misma puntuación y hallazgos. La salida excluye fechas, DNS, estado HTTP real, contenido dependiente del entorno, secretos, wallets y datos de pago.

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
- No secrets, tokens, payment data, or wallet functionality are used.
- This project is independent: it does not publish to or modify Stellar Bazaar or any other provider.

## License

Apache-2.0. See [LICENSE](./LICENSE).
