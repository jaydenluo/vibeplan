# Vibe Plan

Vibe Plan is a self-hosted collaboration layer for Codex-assisted development. The server stores organization-scoped project plans and realtime task events; developers keep source code in Git and run Codex locally through the `vibe` CLI.

## Local development

Requirements: Node.js 22, pnpm 11, and PostgreSQL. Docker Compose provides PostgreSQL:

```bash
pnpm install
docker compose up -d db
cp .env.example .env
pnpm --filter @vibe/api db:migrate
pnpm dev
```

The API runs on `http://localhost:4000` and the web app on `http://localhost:5173`.

## CLI workflow

```bash
pnpm --filter @vibe/cli build
node apps/cli/dist/index.js login --server http://localhost:4000
node apps/cli/dist/index.js init --project-id PROJECT_ID
node apps/cli/dist/index.js task:list
node apps/cli/dist/index.js check
```

The CLI stores session tokens in the operating-system Keychain. Project context is written to `.vibe/project.yaml`; access tokens are never stored in the repository.

## Testing

```bash
pnpm lint
DATABASE_URL=postgres://USER@localhost:PORT/vibe_plan_test pnpm test
pnpm build
```

For production, configure `POSTGRES_PASSWORD`, `AUTH_ACCESS_SECRET`, and SMTP variables, then run `docker compose -f docker-compose.prod.yml up -d --build`.
