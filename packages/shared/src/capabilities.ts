export const CAPABILITIES = [
  "website.read",
  "brand.write",
  "content.write",
  "asset.edit",
  "social.read",
  "social.schedule",
  "social.publish",
  "social.reply",
  "code.read",
  "code.write",
  "code.merge",
  "deploy.preview",
  "deploy.production",
  "spend.ai",
  "spend.media"
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type AutonomyLevel = 1 | 2 | 3 | 4;

export const READ_ONLY_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(["website.read", "social.read", "code.read"]);
