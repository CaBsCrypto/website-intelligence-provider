import { fixtureFor } from "./fixtures.js";
import type { AuditRequest, AuditResponse, Finding, Language } from "./types.js";

export class AuditInputError extends Error {
  readonly code: "INVALID_URL" | "FIXTURE_NOT_FOUND";

  constructor(message: string, code: "INVALID_URL" | "FIXTURE_NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

const copy = {
  en: {
    summary: (score: number, count: number) => `Local audit completed with score ${score}/100 and ${count} findings.`,
    httpsOk: ["HTTPS enabled", "The fixture uses an encrypted origin."],
    langMissing: ["Document language missing", "A language declaration helps assistive technology."],
    langOk: ["Document language declared", "The fixture declares its document language."],
    descriptionMissing: ["Meta description missing", "Search previews may lack a useful summary."],
    descriptionOk: ["Meta description present", "The fixture provides a search summary."],
    altMissing: ["Image alternatives incomplete", "Some fixture images do not include alternative text."],
    altOk: ["Image alternatives complete", "All fixture images include alternative text."],
    scripts: ["Script footprint", "The number of scripts is a deterministic performance indicator."]
  },
  es: {
    summary: (score: number, count: number) => `Auditoría local completada con puntuación ${score}/100 y ${count} hallazgos.`,
    httpsOk: ["HTTPS habilitado", "El fixture usa un origen cifrado."],
    langMissing: ["Falta el idioma del documento", "Declarar el idioma ayuda a las tecnologías de asistencia."],
    langOk: ["Idioma del documento declarado", "El fixture declara el idioma del documento."],
    descriptionMissing: ["Falta la meta descripción", "Las vistas previas de búsqueda pueden carecer de un resumen útil."],
    descriptionOk: ["Meta descripción presente", "El fixture incluye un resumen para buscadores."],
    altMissing: ["Alternativas de imagen incompletas", "Algunas imágenes del fixture no incluyen texto alternativo."],
    altOk: ["Alternativas de imagen completas", "Todas las imágenes del fixture incluyen texto alternativo."],
    scripts: ["Carga de scripts", "La cantidad de scripts es un indicador determinista de rendimiento."]
  }
} as const;

function finding(id: string, category: Finding["category"], severity: Finding["severity"], text: readonly [string, string], evidence: string): Finding {
  return { id, category, severity, title: text[0], detail: text[1], evidence };
}

export function auditWebsite(input: AuditRequest): AuditResponse {
  const language: Language = input.language ?? "en";
  if (language !== "en" && language !== "es") throw new AuditInputError("language must be 'en' or 'es'", "INVALID_URL");
  let url: URL;
  try { url = new URL(input.url); } catch { throw new AuditInputError("url must be an absolute HTTP(S) URL", "INVALID_URL"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AuditInputError("url must be an absolute HTTP(S) URL without credentials", "INVALID_URL");
  }
  const fixture = fixtureFor(url.hostname);
  if (!fixture) throw new AuditInputError(`No local fixture for host: ${url.hostname}`, "FIXTURE_NOT_FOUND");
  const t = copy[language];
  const findings: Finding[] = [
    finding("security.https", "security", fixture.https ? "info" : "high", t.httpsOk, `https=${fixture.https}`),
    finding("accessibility.language", "accessibility", fixture.hasLanguage ? "info" : "medium", fixture.hasLanguage ? t.langOk : t.langMissing, `hasLanguage=${fixture.hasLanguage}`),
    finding("seo.description", "seo", fixture.hasDescription ? "info" : "medium", fixture.hasDescription ? t.descriptionOk : t.descriptionMissing, `hasDescription=${fixture.hasDescription}`)
  ];
  const missingAlt = fixture.imageCount - fixture.imagesWithAlt;
  findings.push(finding("accessibility.image-alt", "accessibility", missingAlt ? "medium" : "info", missingAlt ? t.altMissing : t.altOk, `images=${fixture.imageCount}; withAlt=${fixture.imagesWithAlt}`));
  findings.push(finding("performance.scripts", "performance", fixture.scriptCount > 6 ? "low" : "info", t.scripts, `scriptCount=${fixture.scriptCount}`));
  const penalty = findings.reduce((sum, item) => sum + ({ info: 0, low: 5, medium: 12, high: 25 }[item.severity]), 0);
  const score = Math.max(0, 100 - penalty);
  const canonicalUrl = `${url.protocol}//${url.host}${url.pathname === "/" ? "/" : url.pathname}`;
  return {
    schemaVersion: "1.0", provider: "website-intelligence", mode: "fixture",
    requestedUrl: input.url, canonicalUrl, fixtureId: fixture.id, language,
    summary: t.summary(score, findings.length), score, findings,
    network: { attempted: false, allowed: false }
  };
}
