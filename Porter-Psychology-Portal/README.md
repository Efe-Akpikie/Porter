# Porter Psychology

A full-stack scheduling application for Lara Akinpelu's virtual psychology
practice. It includes a public site, client registration and self-booking, and
an administrator portal for calendar, clients, appointments, waitlist,
availability, and blocked-time management.

## Stack

- React 19, TypeScript, Vite, and Tailwind CSS
- Express 5
- Aiven MySQL through `mysql2`
- HttpOnly cookie sessions and bcrypt password hashing
- OpenAPI-generated Zod validators and React Query hooks
- FullCalendar

The production Express service serves both `/api/*` and the compiled React SPA,
so Render only needs one web service.

## Local development

Requirements: Node.js 22, pnpm 10, and a reachable MySQL 8 database.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Export the values from `.env` in your shell, then run the API and web app in
separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/porter-psychology run dev
```

The Vite app defaults to `http://localhost:22912` and proxies `/api` to
`http://127.0.0.1:8080`.

Useful checks:

```bash
pnpm run typecheck
pnpm run build
```

To test the compiled single-service production build:

```bash
NODE_ENV=production PORT=8080 pnpm run start
```

## Environment variables

| Variable                          | Required         | Purpose                                                                           |
| --------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Yes              | Aiven MySQL URL: `mysql://user:encoded-password@host:port/database`               |
| `MYSQL_CA_CERT`                   | Aiven            | Aiven CA certificate, including PEM header/footer; escaped `\n` is accepted       |
| `ADMIN_EMAIL`                     | Production       | Creates the initial administrator if that email does not exist                    |
| `ADMIN_PASSWORD`                  | Production       | Initial administrator password (minimum 12 characters)                            |
| `ADMIN_NAME`                      | No               | Administrator name; defaults to `Lara Akinpelu`                                   |
| `ADMIN_TIMEZONE`                  | No               | Practice IANA timezone; defaults to `America/Vancouver`                           |
| `DB_CONNECTION_LIMIT`             | No               | MySQL pool size; defaults to `5`                                                  |
| `PORT`                            | Runtime          | HTTP port; Render supplies this                                                   |
| `NODE_ENV`                        | Production       | Set to `production` on Render                                                     |
| `CORS_ORIGIN`                     | No               | Explicit cross-origin frontend URL; unnecessary for the single-service deployment |
| `SEED_DEMO_DATA`                  | Development only | Set to `true` to seed demo accounts; ignored in production                        |
| `APP_URL`                         | Integrations     | Public application origin, without a trailing slash                               |
| `RESEND_API_KEY`                  | Email            | Resend sending API key                                                            |
| `EMAIL_FROM`                      | Email            | Verified sender, such as `Porter Psychology <appointments@updates.example.com>`   |
| `PRACTITIONER_NOTIFICATION_EMAIL` | Email            | Lara's private booking-notification address                                       |
| `STRIPE_SECRET_KEY`               | Payments         | Stripe test or live secret key                                                    |
| `STRIPE_WEBHOOK_SECRET`           | Payments         | Signing secret for this service's Stripe webhook                                  |
| `UPHEAL_MEETING_URL`              | Meetings         | Lara's reusable Upheal waiting-room URL                                           |
| `CRON_SECRET`                     | Reminders        | Bearer token protecting the reminder job                                          |
| `SESSION_IDLE_MINUTES`            | No               | Server-enforced inactivity limit; defaults to `10`                                |

The bootstrap variables never overwrite an existing administrator or reset its
password. After the first successful startup, manage that account in the
database or application rather than treating `ADMIN_PASSWORD` as a reset
mechanism.

## Aiven setup

1. Create a MySQL service and database.
2. Copy its host, port, database, username, password, and CA certificate.
3. URL-encode the username/password when constructing `DATABASE_URL` (special
   characters such as `@`, `:`, `/`, and `#` cannot be pasted raw).
4. Keep Aiven's required TLS/IP access enabled for Render.

The API initializes tables and default availability idempotently at startup.
Scheduling writes use a MySQL advisory lock and transactions to prevent two
users from taking the same slot.

## Render deployment

The repository-root `render.yaml` defines the free Node web service.

1. In Render, create a Blueprint from this GitHub repository.
2. Enter the database/admin secrets requested by the Blueprint.
3. Confirm `ADMIN_TIMEZONE` before deploying.
4. Deploy and verify `/api/healthz`, client registration, client booking, and
   administrator sign-in.

Render's free web service sleeps when idle, so the first request after inactivity
can be slow. Moving to a paid Render instance or paid Aiven plan does not require
code changes; update the service plan/connection secret and redeploy.

## Database and demo data

All appointment and blocked-time timestamps are stored in UTC. Availability is
entered in the practitioner timezone and converted at the API boundary.

Demo data is opt-in and categorically disabled when `NODE_ENV=production`.
For local demo data, set `SEED_DEMO_DATA=true` before the first startup. This
creates:

- `admin@porterpsychology.com` / `admin123`
- `maya.chen@example.com` / `client123`

Do not use those records for real users.

## Resend, Stripe, and Upheal

Email verification is enforced for new registrations only when Resend is fully
configured. Existing accounts are preserved as verified during migration.
Password-reset tokens are random, hashed in MySQL, single-use, and expire after
one hour.

For Stripe:

1. Set test-mode keys in Render.
2. Create a webhook endpoint at
   `https://YOUR_DOMAIN/api/payments/stripe/webhook`.
3. Subscribe it to `checkout.session.completed` and
   `checkout.session.expired`.
4. Copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
5. Configure active CAD prices under **Admin → Availability**.
6. Complete a test payment and refund before switching to live keys.

Paid appointments remain reserved for approximately 30 minutes and become
confirmed only from a signed, amount-validated Stripe webhook. The one-time
15-minute consultation bypasses Stripe. Lara controls refunds manually.

Set `UPHEAL_MEETING_URL` to the reusable waiting-room link. Authenticated
clients can retrieve it only for a confirmed appointment from 15 minutes before
the start through 30 minutes after the end.

Call `POST /api/jobs/appointment-reminders` on a regular schedule with
`Authorization: Bearer CRON_SECRET`. This endpoint sends unsent reminders for
appointments approximately 24 hours away. A scheduler outside a sleeping free
Render service is required.

## Placeholder content and notifications

Search `artifacts/porter-psychology/src/App.tsx` for `[Insert` and
`[Placeholder` to locate copy and image placeholders.

Resend handles verification, account-change, booking, rescheduling,
cancellation, payment-required, and reminder emails. Email content intentionally
omits service type and clinical details. SMS and push delivery are not
implemented.

## Production limitations

This is a functional scheduling MVP, not a complete clinical-record system.
Before storing real client or health information:

- replace all placeholder copy and confirm Lara's credentials/timezone;
- add approved privacy, consent, cancellation, and terms content;
- establish access, retention, audit, backup, and breach-response procedures;
- verify whether the selected Render and Aiven plans provide the agreements and
  controls required by the practice's jurisdiction;
- complete legal, privacy, and security review.

Using TLS and a hosted database does not by itself make the application
HIPAA/PIPEDA compliant.

Porter stores administrative scheduling information only. Keep clinical notes,
session content, video, billing documents, and treatment records in the
practice's approved clinical system (currently intended to be Upheal). The
remaining admin note field is explicitly for non-clinical scheduling
coordination.
