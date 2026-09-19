import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { fetchPublicHtml, LiveAuditError } from './live-fetch.js';
import type { Finding, Language } from './types.js';

export function analyzeHtml(page: Awaited<ReturnType<typeof fetchPublicHtml>>, requestedUrl: string, language: Language = 'es') {
  const root = parse(page.html);
  const nodes: any[] = [], queue: any[] = [root];
  while (queue.length) { const node = queue.pop(); nodes.push(node); for (const child of node.childNodes ?? []) queue.push(child); }
  const attr = (node: any, name: string): string | undefined => node?.attrs?.find((a: any) => a.name === name)?.value;
  const text = (node: any): string => {
    const pending = [node]; let output = '';
    while (pending.length) { const item = pending.pop(); if (item?.nodeName === '#text') output += item.value; else for (const child of (item?.childNodes ?? []).toReversed()) pending.push(child); }
    return output.replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  const tags = (tag: string) => nodes.filter(n => n.tagName === tag);
  const title = text(tags('title')[0]);
  const description = attr(tags('meta').find(n => attr(n, 'name')?.toLowerCase() === 'description'), 'content')?.trim() ?? '';
  const lang = attr(tags('html')[0], 'lang')?.trim() ?? '';
  const headings = nodes.filter(n => /^h[1-6]$/.test(n.tagName ?? ''));
  const h1 = tags('h1').length, images = tags('img'), missingAlt = images.filter(n => attr(n, 'alt') === undefined).length;
  const es = language === 'es';
  const findings: Finding[] = [];
  const add = (id: string, category: Finding['category'], ok: boolean, name: string, nameEn: string, evidence: string, detail: string, detailEn: string) => findings.push({
    id, category, severity: ok ? 'info' : 'medium', title: es ? name : nameEn, detail: es ? detail : detailEn, evidence,
  });
  add('identity.title', 'identity', !!title, 'Título de la página', 'Page title', `title=${title || '(ausente)'}`, title ? 'Se encontró un título en el HTML recibido.' : 'Añadir un título descriptivo a la página.', title ? 'A title was found in the received HTML.' : 'Add a descriptive page title.');
  add('seo.description', 'seo', !!description, 'Descripción para buscadores', 'Search description', `description=${description.slice(0, 300) || '(ausente)'}`, description ? 'El HTML incluye una descripción.' : 'Añadir una meta descripción que resuma el contenido.', description ? 'The HTML includes a description.' : 'Add a meta description summarizing the content.');
  add('accessibility.language', 'accessibility', !!lang, 'Idioma del documento', 'Document language', `html.lang=${lang.slice(0, 80) || '(ausente)'}`, lang ? 'Se observó una declaración de idioma; no se validó su correspondencia con el texto.' : 'Declarar el idioma principal en el elemento html.', lang ? 'A language declaration was observed; correspondence with the text was not checked.' : 'Declare the main language on the html element.');
  add('seo.headings', 'seo', h1 === 1, 'Encabezados', 'Headings', `headings=${headings.length}; h1=${h1}`, h1 === 1 ? 'Se encontró un encabezado principal; no se evaluó toda la jerarquía.' : 'Revisar la estructura: se recomienda un encabezado principal claro.', h1 === 1 ? 'One main heading was found; the full hierarchy was not evaluated.' : 'Review the structure: a clear main heading is recommended.');
  add('accessibility.image-alt', 'accessibility', missingAlt === 0, 'Alternativas de imágenes', 'Image alternatives', `images=${images.length}; missingAlt=${missingAlt}; emptyAlt=${images.filter(n => attr(n, 'alt') === '').length}`, 'Se comprueba la presencia de alt, no su calidad. Un alt vacío puede ser correcto en imágenes decorativas.', 'This checks alt presence, not quality. Empty alt may be appropriate for decorative images.');
  const issues = findings.filter(f => f.severity !== 'info').length;
  return {
    schemaVersion: '1.1', provider: 'website-intelligence', mode: 'live' as const,
    requestedUrl, canonicalUrl: page.finalUrl, finalUrl: page.finalUrl, fetchedAt: page.fetchedAt, language,
    summary: es ? `Se examinó el HTML de una página. Aspectos para revisar: ${issues} de cinco comprobaciones.` : `One page's HTML was examined; ${issues} areas need review across five checks.`,
    score: 100 - issues * 12, scoreLabel: es ? 'Puntuación orientativa' : 'Indicative score', findings,
    limitations: es ? ['Solo HTML recibido; no se ejecutó JavaScript ni se recorrieron enlaces.', 'No es una auditoría completa de seguridad, accesibilidad o rendimiento.', 'La puntuación resta 12 puntos por comprobación pendiente; no representa una certificación.', 'Se utiliza el charset HTTP o UTF-8 cuando no se declara.'] : ['Received HTML only; no JavaScript execution or link crawling.', 'Not a complete security, accessibility or performance audit.', 'The score deducts 12 points per failed check; it is not a certification.', 'Uses the HTTP charset or UTF-8 when unspecified.'],
    evidence: { htmlSha256: createHash('sha256').update(page.html).digest('hex'), httpStatus: page.status, redirects: page.redirects },
    network: { attempted: true, allowed: true },
  };
}
export async function auditLiveWebsite(input: { url: string; language?: Language }) {
  if (!input || typeof input.url !== 'string' || input.url.length > 2048 || (input.language !== undefined && !['es', 'en'].includes(input.language)))
    throw new LiveAuditError('INVALID_INPUT', 'Indica una URL y un idioma es o en.');
  return analyzeHtml(await fetchPublicHtml(input.url), input.url, input.language ?? 'es');
}
