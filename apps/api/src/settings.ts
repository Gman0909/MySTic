import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "./db/index.js";

const { settings } = schema;

/**
 * Instance settings, stored as one row in the settings table.
 * Minimums keep the crawler polite and the live-content cache sane.
 */
export const instanceSettingsSchema = z.object({
  /** Hours between automatic recrawls of each site. Min 6 to avoid hammering upstreams. */
  recrawlHours: z.number().min(6).max(24 * 30).default(24),
  /** Minutes to cache live upstream content for collection rendering/previews. */
  contentTtlMinutes: z.number().min(1).max(24 * 60).default(5),
  /** Use Claude to label ontology concepts (falls back to TF-IDF terms when off or keyless). */
  aiLabeling: z.boolean().default(true),
  /** Anthropic API key for concept labeling; null = use the ANTHROPIC_API_KEY env var if present. */
  anthropicApiKey: z.string().nullable().default(null),
  /** Allow new account registration (the first account is always allowed). */
  allowRegistration: z.boolean().default(true),
  /** Pages fetched concurrently per crawl. Min 1, max 8 — politeness cap. */
  crawlConcurrency: z.number().int().min(1).max(8).default(4),
  /** Public URL of the web app (used in reset links + OAuth redirects), e.g. https://mystic.2i2c.org */
  publicUrl: z.string().url().nullable().default(null),
  /** SMTP for password-reset email. Unset host = no email; admins hand out reset links instead. */
  smtpHost: z.string().nullable().default(null),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().nullable().default(null),
  smtpPass: z.string().nullable().default(null),
  smtpFrom: z.string().nullable().default(null),
  /** GitHub OAuth app for "Continue with GitHub". */
  githubClientId: z.string().nullable().default(null),
  githubClientSecret: z.string().nullable().default(null),
});

export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;

const KEY = "instance";
let cache: InstanceSettings | null = null;

export async function getSettings(db: Db): Promise<InstanceSettings> {
  if (cache) return cache;
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  cache = instanceSettingsSchema.parse(row?.value ?? {});
  return cache;
}

export async function updateSettings(db: Db, patch: Partial<InstanceSettings>): Promise<InstanceSettings> {
  const current = await getSettings(db);
  const next = instanceSettingsSchema.parse({ ...current, ...patch });
  const [existing] = await db.select().from(settings).where(eq(settings.key, KEY));
  if (existing) await db.update(settings).set({ value: next }).where(eq(settings.key, KEY));
  else await db.insert(settings).values({ key: KEY, value: next });
  cache = next;
  return next;
}

/** The key to use for Claude labeling, or undefined when AI labeling is off/keyless. */
export async function labelingApiKey(db: Db): Promise<string | undefined> {
  const s = await getSettings(db);
  if (!s.aiLabeling) return undefined;
  return s.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? undefined;
}
