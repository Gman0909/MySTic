export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  /** postgres:// URL for real Postgres; unset → embedded PGlite in .data/pglite */
  databaseUrl: process.env.DATABASE_URL,
  meiliUrl: process.env.MEILI_URL ?? "http://127.0.0.1:7700",
  meiliKey: process.env.MEILI_MASTER_KEY ?? "mystic-dev-master-key",
  /** Comma-separated allowed browser origins; unset = allow any (local dev). */
  corsOrigins: process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
};
