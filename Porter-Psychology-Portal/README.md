# Porter Psychology

Porter Psychology is a full-stack virtual psychology practice app for Lara Akinpelu, Registered Provisional Psychologist. It includes a public practice site, client self-booking portal, and practitioner workspace with a FullCalendar-based calendar, client records, waitlist, availability, and blocked-time management.

## Demo logins

- Practitioner: `admin@porterpsychology.com` / `admin123`
- Client: `maya.chen@example.com` / `client123`
- Other seeded clients use `client123`

All seeded accounts are demo data. Change these credentials before using the app with real client information.

## Database

The application uses SQLite through `better-sqlite3`. The default file is `data/porter-psychology.sqlite`.

To reset and reseed the demo database:

```bash
rm -f data/porter-psychology.sqlite
```

Restart the API server. The schema and seed records are recreated automatically on startup.

Optional environment variables:

- `SQLITE_PATH` — override the SQLite file location
- `ADMIN_TIMEZONE` — practitioner timezone used for availability and calendar labels; defaults to `America/Vancouver`

All appointment and blocked-time values are stored as UTC ISO timestamps. The UI displays the practitioner timezone label on booking and calendar screens.

## Placeholder content to replace

The public site keeps unknown content clearly marked in `artifacts/porter-psychology/src/App.tsx`:

- `[Insert tagline]`
- `[Insert extended bio]`
- `[Placeholder — replace with headshot]`
- `[Insert service description for X]`

Replace those strings with approved practice copy and the real headshot before launch. No testimonials, awards, or credentials were invented.

## Notification stubs

The app intentionally does not send email, SMS, or push notifications yet:

- `artifacts/api-server/src/routes/practice.ts` — `// TODO: integrate email service for booking confirmation.`
- `artifacts/api-server/src/routes/practice.ts` — `// TODO: integrate email service for cancellation and waitlist availability.`

## Development

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/porter-psychology run dev
```

The API is mounted at `/api` and the web app is served at `/`.