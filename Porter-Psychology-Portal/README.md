# Porter Psychology

A full-stack template for Lara Akinpelu's solo virtual psychology practice. It includes a public marketing site, client self-booking portal, and practitioner workspace for calendar, client, waitlist, availability, and blocked-time management.

## Demo accounts

| Role         | Email                        | Password    |
| ------------ | ---------------------------- | ----------- |
| Practitioner | `admin@porterpsychology.com` | `admin123`  |
| Client       | `maya.chen@example.com`      | `client123` |

The other seeded clients also use `client123`. These credentials and all seeded client records are demonstration data. Change or remove them before handling real client information.

## Run on Replit

The repository is configured as a pnpm workspace with separate web and API Replit artifacts. Use the **Project** Run button to start both services. Replit routes `/` to the React app and `/api` to the Express server.

Local development:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/porter-psychology run dev
```

Useful checks:

```bash
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-spec run codegen
```

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS
- Express 5 API
- SQLite through `better-sqlite3`
- HttpOnly cookie sessions with bcrypt password hashing
- OpenAPI-generated Zod validators and React Query hooks
- FullCalendar day, week, and month calendar

The SQLite schema, lightweight migrations, and seed routine are in:

```text
artifacts/api-server/src/lib/sqlite.ts
```

Appointment and blocked-time timestamps are stored as UTC ISO strings. Availability is entered in the practitioner timezone and converted at the API boundary.

## Environment variables

| Variable         | Default                         | Purpose                                                            |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| `SQLITE_PATH`    | `data/porter-psychology.sqlite` | SQLite database file                                               |
| `ADMIN_TIMEZONE` | `America/Vancouver`             | IANA timezone used for availability, booking, and calendar display |
| `PORT`           | Set by Replit                   | API or Vite service port                                           |
| `BASE_PATH`      | Set by Replit                   | Vite application base path                                         |

Set `ADMIN_TIMEZONE` to Lara's confirmed local IANA timezone before launch.

## Reset and reseed the database

Stop the API server, remove the SQLite file, and restart:

```bash
rm -f data/porter-psychology.sqlite
```

On startup, the API recreates the schema and seeds:

- Lara's admin account
- Four fictional clients
- Four sample appointments in the current week
- Monday–Friday, 09:00–17:00 availability
- Two waitlist entries
- Default service durations and zero-minute buffer

If `SQLITE_PATH` is configured, remove that file instead.

## Placeholder content

Search `artifacts/porter-psychology/src/App.tsx` for these exact strings:

- `[Insert tagline]`
- `[Insert extended bio]`
- `[Placeholder — replace with headshot]`
- `[Insert service description for X]`

Replace them only with approved practice copy and Lara's headshot. The app intentionally contains no testimonials, awards, or credentials beyond those supplied for this template.

## Notification stubs

No email, SMS, or push delivery is implemented. The intentional stubs are in:

```text
artifacts/api-server/src/routes/practice.ts
```

Search for:

```text
// TODO: integrate email service for booking confirmation.
// TODO: integrate email service for cancellation and waitlist availability.
```

Cancellation still updates the matching waitlist entry's database status to `slot_available`; it does not contact the client.

## Before production use

This is a scheduling and portal template, not a complete clinical-record system. Before storing real client or health information:

- replace demo credentials and seed records;
- confirm the practitioner timezone and approved site copy;
- review privacy, consent, retention, audit, backup, and breach-response requirements;
- configure HTTPS, secure cookies, secrets, monitoring, and encrypted backups;
- complete a legal and security review for the jurisdictions where the practice operates.
