import { integer, jsonb, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

export const sites = pgTable("sites", {
  id: text("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  pageCount: integer("page_count").notNull().default(0),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const pages = pgTable("pages", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull(),
  slug: text("slug").notNull(),
  url: text("url").notNull(),
  title: text("title"),
  sha256: text("sha256").notNull(),
  frontmatter: jsonb("frontmatter"),
  /** Cached upstream AST — fallback for collection rendering when upstream is down. */
  ast: jsonb("ast"),
  sectionCount: integer("section_count").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const sections = pgTable("sections", {
  /** Same id as the Meilisearch document. */
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull(),
  pageId: text("page_id").notNull(),
  slug: text("slug").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  headingPath: jsonb("heading_path").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 384 }),
  conceptId: text("concept_id"),
});

export const concepts = pgTable("concepts", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  parentId: text("parent_id"),
  /** Hash of sorted member section ids — lets rebuilds reuse labels for unchanged clusters. */
  memberHash: text("member_hash").notNull(),
  sectionCount: integer("section_count").notNull().default(0),
  siteCounts: jsonb("site_counts").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: text("is_admin").notNull().default("false"),
  /** Hash of the account recovery code (shown once at creation; null until generated for OAuth users). */
  recoveryHash: text("recovery_hash"),
  /** Opt-in public profile: /u/<handle> lists the user's public collections. */
  handle: text("handle").unique(),
  profilePublic: text("profile_public").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});


export const authSessions = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const collections = pgTable("collections", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id"),
  visibility: text("visibility").notNull().default("unlisted"),
  /** How the landing page presents the contents: list (a table of contents) | gallery (cards). */
  layout: text("layout").notNull().default("list"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const collectionNodes = pgTable("collection_nodes", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull(),
  parentId: text("parent_id"),
  position: integer("position").notNull().default(0),
  /** part (grouping heading) | page (whole upstream page) | section (page fragment at anchor) */
  kind: text("kind").notNull(),
  siteId: text("site_id"),
  pageSlug: text("page_slug"),
  anchor: text("anchor"),
  /** Part title, or title override for page/section nodes (null = upstream title). */
  title: text("title"),
  /** Parts only: list | gallery presentation for this part's children (null = the collection's default). */
  layout: text("layout"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const crawlJobs = pgTable("crawl_jobs", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull(),
  status: text("status").notNull().default("queued"),
  log: text("log").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
});
