export type Language = "en" | "es";

export interface AuditRequest {
  url: string;
  language?: Language;
}

export interface Finding {
  id: string;
  category: "identity" | "security" | "seo" | "accessibility" | "performance";
  severity: "info" | "low" | "medium" | "high";
  title: string;
  detail: string;
  evidence: string;
}

export interface AuditResponse {
  schemaVersion: "1.0";
  provider: "website-intelligence";
  mode: "fixture";
  requestedUrl: string;
  canonicalUrl: string;
  fixtureId: string;
  language: Language;
  summary: string;
  score: number;
  findings: Finding[];
  network: { attempted: false; allowed: false };
}

export interface Fixture {
  id: string;
  hosts: string[];
  title: string;
  description: string;
  https: boolean;
  hasLanguage: boolean;
  hasViewport: boolean;
  hasDescription: boolean;
  headingCount: number;
  imageCount: number;
  imagesWithAlt: number;
  scriptCount: number;
}
