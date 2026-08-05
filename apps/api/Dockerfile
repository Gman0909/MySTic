# Build context is the repo root (see docker-compose.yml).
FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
