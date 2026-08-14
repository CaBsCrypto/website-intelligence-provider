import type { Fixture } from "./types.js";

const fixtures: Fixture[] = [
  {
    id: "example-com-v1",
    hosts: ["example.com", "www.example.com"],
    title: "Example Domain",
    description: "A minimal standards-oriented example page.",
    https: true,
    hasLanguage: true,
    hasViewport: true,
    hasDescription: false,
    headingCount: 1,
    imageCount: 0,
    imagesWithAlt: 0,
    scriptCount: 0
  },
  {
    id: "stellar-demo-v1",
    hosts: ["stellar.local", "demo.stellar.local"],
    title: "Stellar Demo",
    description: "A richer deterministic fixture for local integration tests.",
    https: true,
    hasLanguage: false,
    hasViewport: true,
    hasDescription: true,
    headingCount: 3,
    imageCount: 4,
    imagesWithAlt: 2,
    scriptCount: 7
  }
];

export function fixtureFor(hostname: string): Fixture | undefined {
  return fixtures.find((fixture) => fixture.hosts.includes(hostname.toLowerCase()));
}

export function fixtureIds(): string[] {
  return fixtures.map(({ id }) => id);
}
