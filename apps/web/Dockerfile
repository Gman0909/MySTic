# Build context is the repo root (see docker-compose.yml).
FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN corepack enable && pnpm install --frozen-lockfile && cd apps/web && pnpm exec next build
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
