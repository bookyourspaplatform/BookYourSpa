# BookYourSpa — Spa & Wellness Marketplace and Booking Platform

Multi-vendor marketplace for spa and wellness bookings: customers discover spas and
book treatments online, spa suppliers run their branches and calendars, agents and
resellers sell at negotiated rates, and the platform owner administers everything.

**Target markets:** Bali (Indonesia), Dubai (UAE), international expansion.
**Deployment target:** Vercel.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, `src/proxy.ts` route protection) |
| Styling | Tailwind CSS v4 (`@tailwindcss/turbopack`) |
| Database | PostgreSQL — Drizzle ORM; embedded PGlite locally, any Postgres in production |
| Auth | Signed JWT session cookie (`jose`, HS256) + scrypt password hashing |
| Payments | Stripe, PayPal, Razorpay — each optional; pay-at-venue always available |
| Email | Resend (vouchers), with a persistent outbox fallback |
| Validation / tests | Zod · Vitest |

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL` set, the app boots an embedded
file-backed PostgreSQL in `.data/local`, applies migrations automatically and seeds
demo data on first run.

Useful commands:

```bash
npm run dev         # start dev server
npm run build       # migrate + production build
npm start           # serve the production build
npm test            # vitest suite
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run db:migrate  # apply pending migrations
npm run db:seed     # insert demo data (idempotent; refuses to overwrite)
npm run db:reset    # wipe the LOCAL database and re-seed (never touches DATABASE_URL)
```

### Demo logins (seeded development data)

| Role | Email | Password |
| --- | --- | --- |
| Super Admin | `portal@bookyourspa.net` | `BYS154@bys` |
| Supplier / POS (Dubai, AED) | `booking@homecarespa.ae` | `HCS154@bys` |
| Supplier / POS | `owner@aranjaya.com` | `HCS154@bys` |
| Agent / Reseller | `info@balithingstodo.net` | `BTTD154@bys` |
| Customer | `appsdaeng@gmail.com` | `apps154@bys` |

Coupons: `WELCOME10` · `BALI20` · `SEMINYAK50`.

## What is in the box

**Customer site (mobile-first, SEO-optimised)** — home, spa discovery and search,
spa and branch pages with menus/prices, a 4-step booking wizard (treatment → date &
time → details → review), guest or account checkout, live availability, coupons,
instant voucher at `/voucher/[CODE]`, JSON-LD structured data, sitemap, robots,
canonical metadata and per-route Open Graph images.

**Supplier console (`/provider`)** — branches, treatment menus and prices,
therapists, appointment calendar with complete / no-show / cancel actions, staff
availability and working hours, bookings, earnings with net-after-fee reporting.

**Agent console (`/agent`)** — approved product catalogue, negotiated agent rates,
bookings made on behalf of customers, sales and commission tracking with pending
payouts.

**Super Admin console (`/admin`)** — providers and approvals, agents, bookings,
payments, commission payouts, content and promotion management, SEO and system
configuration (lead times, cancellation window, commission bps, feature flags),
audit log.

**Platform services** — availability engine with conflict-safe booking creation
(re-validated inside the transaction), pricing (list price, coupons, agent rates,
commissions), per-identifier login throttling, same-origin checks on mutations,
security headers and CSP, audit logging, webhooks for all three gateways.

## Environment variables

Copy `.env.example` to `.env.local` for development. In Vercel add them under
**Project → Settings → Environment Variables** for Production (and Preview if you
want previews to work against a real database).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Yes (production)** | Postgres connection string. Use the **pooled** URL (port 6543) on Supabase. |
| `AUTH_SECRET` | **Yes (production)** | Session signing key, ≥16 chars. The app refuses to start without it in production. |
| `NEXT_PUBLIC_APP_URL` | Yes | Public origin, e.g. `https://www.bookyourspa.net` (canonical URLs, vouchers, emails). |
| `PG_SSL` / `PG_POOL_MAX` | Optional | `PG_SSL=true` when your provider requires TLS without client certs; pool size (default 10). |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional | Enables Stripe checkout. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` | Optional | Enables PayPal (`live` or `sandbox`). |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Optional | Enables Razorpay (INR markets). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional | Voucher email delivery; without it, vouchers render on-site and mail is logged as skipped. |
| `MIGRATE_ON_BOOT` | Optional | `true` also runs migrations when the server boots (build-time migration is the default). |

Missing payment keys simply disable that gateway — pay-at-venue keeps working, so
the platform is fully usable before any gateway is configured.

## Deploying to Vercel

> The production database must be a real Postgres (Vercel Postgres/Neon,
> Supabase, Railway, Aiven…). The embedded PGlite fallback is for local
> development only — it is file-backed and cannot persist across serverless
> invocations.

### 1. Create the database

Provision a Postgres instance and copy its **pooled** connection string, e.g.

```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0.[REGION].pooler.supabase.com:6543/postgres?sslmode=require
```

### 2. Import the project

Push the repository to GitHub/GitLab/Bitbucket and import it at
[vercel.com/new](https://vercel.com/new). Vercel auto-detects Next.js; the default
build command (`npm run build`) is correct — it applies migrations before
`next build`, so schema changes ship with every deploy.

### 3. Set environment variables

Project → Settings → Environment Variables. Minimum viable production:

```
DATABASE_URL      = <pooled postgres url>
AUTH_SECRET       = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
NEXT_PUBLIC_APP_URL = https://www.bookyourspa.net
```

Add the payment and email keys as you enable those services.

### 4. Seed the production database (once)

From your machine, pointed at production — the seed is idempotent and refuses to
overwrite existing data unless you pass `--force`:

```bash
DATABASE_URL="<production pooled url>" npm run db:seed
```

This creates the Super Admin (`portal@bookyourspa.net`), demo suppliers/agents and
sample content so the consoles are populated. **Change the seeded passwords
immediately** (Admin → System) before opening the platform to real users.

### 5. Deploy

Click **Deploy**. Verify afterwards:

- `https://www.bookyourspa.net` renders and `/spas` lists inventory
- `/sitemap.xml` and `/robots.txt` return 200
- each of the four login pages signs in and lands on its own console
- a test booking produces a voucher at `/voucher/[CODE]`

### 6. Point the domain and webhooks

Add `www.bookyourspa.net` (and the apex) under Project → Domains, with the DNS
records your registrar needs. Then register the webhook endpoints with each
payment gateway you use — they must point at the production origin:

```
https://www.bookyourspa.net/api/webhooks/stripe
https://www.bookyourspa.net/api/webhooks/paypal
https://www.bookyourspa.net/api/webhooks/razorpay
```

Finally set **Admin → System → Site URL** to `https://www.bookyourspa.net` so
canonical links, sitemap entries and voucher emails use the live origin.

### Notes for production

- **Sessions** are stateless JWT cookies (`AUTH_SECRET`), so they work across
  serverless instances without a shared store. Rotating `AUTH_SECRET` signs
  everyone out.
- **Rate limiting** is in-memory per isolate. That is effective but not global;
  for hard guarantees across instances put Cloudflare/Vercel WAF rules in front of
  `/api/bookings`, `/api/quote` and `/api/auth/login`.
- **Migrations** run at build time against `DATABASE_URL`. Keep the `drizzle/`
  folder in the repository — the build needs it.
- **PGlite and `pg` are marked `serverExternalPackages`** in `next.config.ts`;
  do not remove that, PGlite loads WASM via `import.meta.url`.
- The `src/proxy.ts` matcher excludes `api/`, `_next/static`, `_next/image`,
  `robots.txt` and `sitemap.xml`. Keep those exclusions — dropping
  `_next/static` breaks client hydration in development.

## Security posture

- Signed, `httpOnly`, `SameSite=Lax` session cookies; scrypt password hashing
- Route protection in `src/proxy.ts` (redirects by role) **and** deep
  `requireUser()` checks inside every dashboard layout and API mutation
- Zod validation on every write path; booking conflicts re-checked inside the
  creating transaction
- Same-origin checks on mutating endpoints, per-identifier login throttling,
  security headers + CSP in `next.config.ts`
- Audit log for privileged actions (bookings, approvals, settings changes)

## Project layout

```
src/
├── app/
│   ├── (site)/          # public marketplace: home, spas, vouchers, SEO routes
│   ├── login/ register/ # four role-specific auth pages
│   ├── provider/        # Supplier & POS console
│   ├── agent/           # Agent / Reseller console
│   ├── admin/           # Super Admin console
│   └── api/             # availability, quote, bookings, payments, webhooks
├── components/          # booking wizard, dashboards, ui primitives
├── lib/                 # availability, pricing, booking, auth, security, seo
├── db/                  # schema, migrations, seed, CLI
└── proxy.ts             # edge-safe session guard (Next 16 middleware)
```
