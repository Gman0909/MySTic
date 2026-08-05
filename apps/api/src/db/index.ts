import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { env } from "../env.js";

export { schema };

// Common supertype of the PGlite and postgres-js drizzle instances; the
// query-builder API we use (select/insert/update/delete/execute) is identical.
export type Db = PgDatabase<any, typeof schema>;

export async function createDb(): Promise<Db> {
  if (env.databaseUrl?.startsWith("postgres")) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { default: postgres } = await import("postgres");
    return drizzle(postgres(env.databaseUrl), { schema }) as unknown as Db;
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { mkdirSync } = await import("node:fs");
  const dataDir = "./.data/pglite";
  mkdirSync(dataDir, { recursive: true }); // PGlite's own mkdir is not recursive
  const client = new PGlite(dataDir, { extensions: { vector } });
  return drizzle(client, { schema }) as unknown as Db;
}

/** Idempotent bootstrap DDL — v1 stand-in for drizzle-kit migrations. Keep in sync with schema.ts. */
export async function migrate(db: Db): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sections (
      id text PRIMARY KEY,
      site_id text NOT NULL,
      page_id text NOT NULL,
      slug text NOT NULL,
      url text NOT NULL,
      title text NOT NULL,
      heading_path jsonb NOT NULL,
      text text NOT NULL,
      embedding vector(384),
      concept_id text
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sections_site_idx ON sections (site_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sections_concept_idx ON sections (concept_id);`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS concepts (
      id text PRIMARY KEY,
      label text NOT NULL,
      description text,
      parent_id text,
      member_hash text NOT NULL,
      section_count integer NOT NULL DEFAULT 0,
      site_counts jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sites (
      id text PRIMARY KEY,
      url text NOT NULL UNIQUE,
      title text,
      status text NOT NULL DEFAULT 'pending',
      error text,
      page_count integer NOT NULL DEFAULT 0,
      last_crawled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pages (
      id text PRIMARY KEY,
      site_id text NOT NULL,
      slug text NOT NULL,
      url text NOT NULL,
      title text,
      sha256 text NOT NULL,
      frontmatter jsonb,
      ast jsonb,
      section_count integer NOT NULL DEFAULT 0,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (site_id, slug)
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      is_admin text NOT NULL DEFAULT 'false',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token text PRIMARY KEY,
      user_id text NOT NULL,
      expires_at timestamptz NOT NULL
    );
  `);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS handle text UNIQUE;`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public text NOT NULL DEFAULT 'false';`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
  `);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_hash text;`);
  await db.execute(sql`DROP TABLE IF EXISTS password_resets;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS collections (
      id text PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      owner_id text,
      visibility text NOT NULL DEFAULT 'unlisted',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`ALTER TABLE collections ADD COLUMN IF NOT EXISTS owner_id text;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS collection_nodes (
      id text PRIMARY KEY,
      collection_id text NOT NULL,
      parent_id text,
      position integer NOT NULL DEFAULT 0,
      kind text NOT NULL,
      site_id text,
      page_slug text,
      anchor text,
      title text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS collection_nodes_coll_idx ON collection_nodes (collection_id);`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id text PRIMARY KEY,
      site_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      log text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz
    );
  `);
}
