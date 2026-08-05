# Deploying MySTic to mystic.2i2c.org

Target shape: **Netlify serves the Next.js frontend** at `mystic.2i2c.org` (auto-deploying on push to `main`, like engagements.2i2c.org), and **a small server runs the backend** — API + Meilisearch + Postgres — at `api.mystic.2i2c.org`.

MySTic cannot run entirely on Netlify: the search engine, database, and crawler are long-running processes with persistent disk, which Netlify's static/serverless model doesn't provide. Only the frontend goes there.

```
browser ──HTTPS──> Netlify (Next.js at mystic.2i2c.org)
   │
   └────HTTPS──> Caddy ──> API (:4000) ──> Meilisearch + Postgres
                 (api.mystic.2i2c.org, one VM via docker compose)
```

## Part 1 — Backend (do this first)

You need: a small VM (2 vCPU / 4 GB RAM / 20 GB disk is plenty — Hetzner CX22, DigitalOcean, or a 2i2c-managed box) with Docker installed, and access to 2i2c.org DNS.

1. **DNS**: create an `A` record `api.mystic.2i2c.org` → the VM's IP.
2. On the VM:
   ```bash
   git clone https://github.com/Gman0909/MySTic.git && cd MySTic/deploy/backend
   cp .env.example .env
   # edit .env: strong POSTGRES_PASSWORD + MEILI_MASTER_KEY, API_DOMAIN, CORS_ORIGINS
   docker compose up -d --build
   ```
   Caddy obtains the TLS certificate automatically once DNS resolves.
3. Verify: `curl https://api.mystic.2i2c.org/api/health` → `{"ok":true}`.
4. First boot imports `seed/sites.json` and starts crawling/embedding (~15–20 min; watch `docker compose logs -f api`).

> Images are also built, smoke-tested, and published by CI on every push: `ghcr.io/gman0909/mystic-api:latest`. To use it instead of building on the VM, replace the `build:` block in `deploy/backend/docker-compose.yml` with `image: ghcr.io/gman0909/mystic-api:latest`.

## Part 2 — Netlify frontend

In the Netlify team UI (same team that owns engagements.2i2c.org):

1. **Add new site → Import an existing project → GitHub → `Gman0909/MySTic`.** The committed `netlify.toml` supplies base (`apps/web`), build command, and the Next.js plugin — no manual build settings needed.
2. **Site settings → Environment variables**: add `NEXT_PUBLIC_API_URL = https://api.mystic.2i2c.org`. (Build-time value — change requires a redeploy.)
3. Trigger the first deploy and check the deploy log.
4. **Domain management → Add domain alias → `mystic.2i2c.org`**, then create the DNS record it asks for (CNAME `mystic` → your Netlify site's `*.netlify.app` hostname — same pattern as `engagements`).
5. **Contributor-approval gotcha** (bit us on engagement-insights): if deploys sit at "pending review", a Team Owner must approve/match the pushing GitHub account once — Deploys → Start approval process → Approve and add as Git Contributor.

## Part 3 — Immediately after it's live

1. **Register the first account right away — it becomes the instance administrator.** On a public URL, don't leave this window open.
2. Sign in → Admin → Instance settings: consider turning **Open registration off** (or leave it on for colleagues and close it later), and paste an Anthropic API key if you want Claude-written knowledge-tree labels.
3. Optionally trigger `POST /api/ontology/rebuild` from the admin panel after the seed crawl completes.

## Updating

- **Frontend**: push to `main` — Netlify auto-builds.
- **Backend**: on the VM, `cd MySTic && git pull && cd deploy/backend && docker compose up -d --build`.

## After deploying: auth polish

- Set **Public URL** in Admin → Instance settings (used in password-reset links and OAuth redirects), and set the `API_PUBLIC_URL` env var on the API container (e.g. `https://api.mystic.2i2c.org`) so the GitHub OAuth callback URL is correct.
- Optional **SMTP** settings enable password-reset email; without them, admins generate reset links from the Users table.
- Optional **GitHub sign-in**: create a GitHub OAuth App with callback `https://api.mystic.2i2c.org/api/auth/oauth/github/callback` and paste its client id/secret into Instance settings.

## Known gaps before wide sharing

- No rate limiting on the API (auth endpoints included).
- Netlify deploy previews get a different origin — add their URL to `CORS_ORIGINS` if you want previews to talk to the API.
