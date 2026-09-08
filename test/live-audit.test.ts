import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';
import { analyzeHtml } from '../src/live-audit.js';
import { fetchPublicHtml, publicAddress, publicUrl, requestPage } from '../src/live-fetch.js';
const page = (html: string) => ({ html, finalUrl: 'https://example.com/', fetchedAt: '2026-09-08T12:00:00.000Z', status: 200, redirects: 0 });
test('real HTML produces evidence; empty alt is not falsely flagged', () => {
  const output = analyzeHtml(page('<html lang="es"><head><title>A &amp; B</title><meta name="description" content="Descripción"></head><body><h1>Hola</h1><img alt=""><script>"<img>"</script></body></html>'), 'https://example.com');
  assert.equal(output.mode, 'live'); assert.equal(output.language, 'es'); assert.equal(output.score, 100);
  assert.match(output.findings[0].evidence, /A & B/); assert.match(output.findings[4].evidence, /images=1; missingAlt=0; emptyAlt=1/);
  const incomplete = analyzeHtml(page('<img><h2>Hola</h2>'), 'https://example.com');
  assert.equal(incomplete.score, 40); assert.match(incomplete.findings[4].evidence, /missingAlt=1/);
});
test('blocks special IP ranges and URL tricks', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('93.184.216.34'), true);
  for (const url of ['file:///etc/passwd', 'http://2130706433', 'http://[::1]', 'https://user:pass@example.com', 'https://example.com/?api_key=private', 'http://localhost', 'https://example.com:9000']) assert.throws(() => publicUrl(url));
});
test('pins validated address and validates every redirect and all DNS answers', async () => {
  let calls = 0;
  const deps = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (_url: URL, address: {address: string}) => { assert.equal(address.address, '93.184.216.34'); calls++; return { status: 302, location: 'http://127.0.0.1' }; } };
  await assert.rejects(fetchPublicHtml('https://example.com', deps), { code: 'BLOCKED_DESTINATION' }); assert.equal(calls, 1);
  await assert.rejects(fetchPublicHtml('https://example.com', { ...deps, resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] }), { code: 'BLOCKED_DESTINATION' }); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchPublicHtml('https://example.com', { ...deps, request: async () => { calls++; return { status: 302, location: '/next' }; } }), { code: 'REDIRECT_LIMIT' }); assert.equal(calls, 4);
  calls = 0;
  const result = await fetchPublicHtml('https://example.com', { ...deps, request: async () => ++calls <= 3 ? { status: 302, location: '/next' } : { status: 200, html: '<title>OK</title>' } });
  assert.equal(result.redirects, 3);
  await assert.rejects(fetchPublicHtml('https://example.com', { ...deps, resolve: () => new Promise(() => {}) }, 20), { code: 'TIMEOUT' });
});
test('actual transport pins DNS, sends no credentials, bounds bytes and rejects incompatible bodies', async t => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.host?.startsWith('public.example:'), true);
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (req.url === '/large') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('a'.repeat(2_000_001)); }
    if (req.url === '/error') { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<title>Real</title>');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const address = server.address(); assert(address && typeof address === 'object');
  const get = (path: string) => requestPage(new URL(`http://public.example:${address.port}${path}`), { address: '127.0.0.1', family: 4 }, AbortSignal.timeout(2000));
  assert.equal((await get('/')).html, '<title>Real</title>');
  await assert.rejects(get('/json'), { code: 'UNSUPPORTED_CONTENT' });
  await assert.rejects(get('/large'), { code: 'HTML_TOO_LARGE' });
  await assert.rejects(get('/error'), { code: 'HTTP_ERROR' });
});
test('HTTP reports live input failures and refuses live purchases before payment', async t => {
  const server = createAppServer().listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => server.close());
  const address = server.address(); assert(address && typeof address === 'object');
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const blocked = await post('/v1/audits', { mode: 'live', url: 'http://127.0.0.1' });
  assert.equal(blocked.status, 422); assert.equal((await blocked.json()).error.code, 'BLOCKED_DESTINATION');
  const paid = await post('/v1/x402/audits', { mode: 'live', url: 'https://example.com' });
  assert.equal(paid.status, 400); assert.equal((await paid.json()).error.code, 'LIVE_PAYMENT_NOT_ENABLED');
  assert.equal((await post('/v1/audits', { mode: 'unknown', url: 'https://example.com' })).status, 422);
});
