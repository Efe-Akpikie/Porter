# Porter Psychology

Full-stack virtual psychology practice template with a public site, client self-booking portal, and practitioner workspace.

## Run and operate

- `pnpm --filter @workspace/api-server run dev` — API service
- `pnpm --filter @workspace/porter-psychology run dev` — web service
- `pnpm run typecheck` — check all packages
- `pnpm run build` — typecheck and build all artifacts
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas

Optional runtime variables:

- `SQLITE_PATH` — defaults to `data/porter-psychology.sqlite`
- `ADMIN_TIMEZONE` — defaults to `America/Vancouver`

## Stack

- pnpm workspaces, Node.js 24, TypeScript
- React, Vite, Tailwind CSS, Wouter, TanStack Query
- Express
- SQLite via `better-sqlite3`
- OpenAPI, Orval, Zod
- FullCalendar

## Sources of truth

- SQLite schema, migration, and seeds: `artifacts/api-server/src/lib/sqlite.ts`
- Scheduling and management routes: `artifacts/api-server/src/routes/practice.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Application UI and routes: `artifacts/porter-psychology/src/App.tsx`
- Theme: `artifacts/porter-psychology/src/index.css`

## Architecture decisions

- Appointment and blocked-time timestamps are stored in UTC.
- Recurring availability is interpreted in `ADMIN_TIMEZONE`.
- Authentication uses HttpOnly cookie sessions and backend role guards.
- API client hooks and request validators are generated from OpenAPI.
- SQLite initializes automatically when the API starts; no external database service or schema-push command is required.

## Gotchas

- Run API code generation after changing `openapi.yaml`.
- Unknown marketing content must remain visibly marked with the approved bracketed placeholders.
- Do not add email, SMS, or push delivery until the TODO stubs are intentionally integrated.
