import test from 'node:test';
import assert from 'node:assert/strict';
import { loadX402Config } from '../src/x402/config.js';
const env = { VERCEL:'1', VERCEL_ENV:'preview', VERCEL_URL:'website-review-123.vercel.app', X402_USE_PREVIEW_ORIGIN:'true', X402_PUBLIC_BASE_URL:'https://production.example', X402_ALLOWED_PUBLIC_BASE_URLS:'https://production.example', X402_SETTLEMENT_ENABLED:'true', WEBSITE_INTELLIGENCE_LIVE_ENABLED:'true', X402_STELLAR_PAY_TO:'GAHOZFSDG2DW32FOUUP6XA4SMN3OCR7NOUXHAPYFN47BLJX56GJ3WCSM', STELLAR_X402_FACILITATOR_API_KEY:'test-only', WEBSITE_INTELLIGENCE_REDIS_REST_URL:'https://redis.example', WEBSITE_INTELLIGENCE_REDIS_REST_TOKEN:'test-only' };
test('explicit Preview origin binds the deployment and cannot fall back to production', () => {
 const config=loadX402Config(env); assert.equal(config.publicBaseUrl,'https://website-review-123.vercel.app'); assert.equal(config.liveEnabled,true);
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_URL:'evil.example'},{VERCEL_URL:''},{VERCEL:'0'}]) { const bad=loadX402Config({...env,...change}); assert.equal(bad.enabled,false); assert.equal(bad.publicBaseUrl,'https://invalid.local'); }
 assert.equal(loadX402Config({...env,X402_USE_PREVIEW_ORIGIN:'false'}).publicBaseUrl,'https://production.example');
});
