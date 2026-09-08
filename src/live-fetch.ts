import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';

export class LiveAuditError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const LIVE_LIMITS = { bytes: 2_000_000, redirects: 3, milliseconds: 10_000 };
export function publicAddress(address: string): boolean {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}
export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new LiveAuditError('INVALID_URL', 'URL HTTP(S) inválida.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      [...url.searchParams.keys()].some(key => /token|secret|password|authorization|signature|api.?key|credential|cookie/i.test(key)) ||
      (url.port && !['80', '443'].includes(url.port)) ||
      host === 'localhost' || host.endsWith('.localhost') ||
      (ipaddr.isValid(host) && !publicAddress(host)))
    throw new LiveAuditError('BLOCKED_DESTINATION', 'Solo se permiten destinos HTTP(S) públicos en puertos estándar.');
  url.hash = '';
  return url;
}
type Address = { address: string; family: number };
type Hop = { status: number; location?: string; html?: string };
export type FetchDependencies = {
  resolve: (host: string) => Promise<Address[]>;
  request: (url: URL, address: Address, signal: AbortSignal) => Promise<Hop>;
};
export function requestPage(url: URL, address: Address, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      agent: false, signal,
      // Pin the validated DNS answer; never perform a second lookup during connection.
      lookup: ((_host: unknown, options: any, callback: any) => options?.all
        ? callback(null, [address]) : callback(null, address.address, address.family)) as any,
      headers: { accept: 'text/html', 'accept-encoding': 'identity', 'user-agent': 'WebsiteIntelligence/1.0 (single-page HTML audit)' },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        resolve({ status, location: response.headers.location }); response.destroy(); return;
      }
      const fail = (code: string, message: string) => { reject(new LiveAuditError(code, message)); response.destroy(); };
      if (status < 200 || status >= 300) return fail('HTTP_ERROR', `La página respondió HTTP ${status}.`);
      const contentType = response.headers['content-type'] ?? '';
      if (!/^text\/html(?:\s*;|$)/i.test(contentType)) return fail('UNSUPPORTED_CONTENT', 'La respuesta no es HTML compatible.');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
        return fail('UNSUPPORTED_ENCODING', 'El servidor no entregó contenido sin compresión.');
      if (Number(response.headers['content-length']) > LIVE_LIMITS.bytes) return fail('HTML_TOO_LARGE', 'El HTML supera 2 MB.');
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? 'utf-8';
      let decoder: TextDecoder;
      try { decoder = new TextDecoder(charset); } catch { return fail('UNSUPPORTED_ENCODING', 'Codificación de HTML no compatible.'); }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > LIVE_LIMITS.bytes) fail('HTML_TOO_LARGE', 'El HTML supera 2 MB.');
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status, html: decoder.decode(Buffer.concat(chunks)) }));
    });
    request.on('error', reject); request.end();
  });
}
const defaults: FetchDependencies = { resolve: host => lookup(host, { all: true, verbatim: true }), request: requestPage };
export async function fetchPublicHtml(value: string, dependencies = defaults, timeout = LIVE_LIMITS.milliseconds) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new LiveAuditError('TIMEOUT', 'La consulta superó diez segundos.')); }, timeout);
  });
  try {
    return await Promise.race([expired, (async () => {
      let url = publicUrl(value);
      for (let redirects = 0; ; redirects++) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = ipaddr.isValid(host)
          ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
          : await dependencies.resolve(host);
        controller.signal.throwIfAborted();
        if (!addresses.length || addresses.some(a => !publicAddress(a.address)))
          throw new LiveAuditError('BLOCKED_DESTINATION', 'El destino resuelve a una dirección no pública.');
        const page = await dependencies.request(url, addresses[0], controller.signal);
        if ([301, 302, 303, 307, 308].includes(page.status)) {
          if (redirects >= LIVE_LIMITS.redirects || !page.location)
            throw new LiveAuditError('REDIRECT_LIMIT', 'Redirección inválida o más de tres redirecciones.');
          url = publicUrl(new URL(page.location, url).href); continue;
        }
        return { html: page.html!, finalUrl: url.href, status: page.status, redirects, fetchedAt: new Date().toISOString() };
      }
    })()]);
  } catch (error) {
    if (error instanceof LiveAuditError) throw error;
    throw new LiveAuditError('FETCH_FAILED', 'No se pudo consultar la página pública.');
  } finally { clearTimeout(timer!); controller.abort(); }
}
