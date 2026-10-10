# AGENTS.md: Pixel Pirates

Digital-risk-protection app (HackXLerate 2026, built by team Pixel Pirates; formerly named "Digital Shield"). It detects impersonating domains, social profiles and apps for registered brands.

## Architecture

- **Frontend (`public/`)**: plain HTML + CSS + ES-module JS, no build step or framework. Netlify serves pretty URLs (`/dashboard` → `dashboard.html`).
  - `js/core.js` holds the shared app shell (`mountShell(page, {title})` wraps `#app` content in the sidebar and topbar), `api()` client, toasts, modals, `confirmDialog`, form error helpers (`showErrors` maps API `fields` to inputs) and badge/format helpers. Every page script imports from it.
  - One script per screen: `dashboard.js`, `brands.js`, `scanner.js`, `investigations.js`. The landing page (`index.html` + `css/landing.css`) has no app shell.
  - CDN libraries: Chart.js 4 (dashboard only) and Lucide 0.469 icons (`<i data-lucide>`; call `icons()` after each render).
- **API (`netlify/functions/*.mts`)**: one function per resource, routed with `config.path` arrays (`/api/brands`, `/api/brands/:id`, …). Handlers are wrapped in `handle()` from `lib/http.ts`, which converts Zod errors to `422 {error, fields}` and `HttpError` to JSON.
- **Domain logic (`lib/`)**: `risk.ts` is the scoring engine (pure, no I/O). Each signal has a weight and the score is the clamped sum. Levels: ≥75 critical, ≥50 high, ≥25 medium. `validation.ts` holds the Zod v4 schemas (normalises domains/handles), and `normalize.ts` holds the domain and handle parsing.
- **Database**: Netlify Database (Postgres) via Drizzle (`drizzle-orm@beta`, adapter `drizzle-orm/netlify-db`). Tables: `brands`, `scans` (signals stored as jsonb), `investigations`, `activity`. Deleting a brand cascades to its scans and investigations. Deleting a scan sets `investigations.scan_id` to null.

## Conventions

- Log user-visible mutations with `logActivity(type, message)`. Types map to icons in `ACTIVITY_STYLE` in `core.js`.
- "Suspicious" = risk level ≠ low; "high-risk" = high or critical; "open investigation" = status in open/in_progress/takedown_requested.
- Dashboard numbers must always come from `/api/stats`. Never hardcode them.
- Client-side validation mirrors the server, but the server is the source of truth (duplicate checks are case-insensitive on name, exact on normalised domain).
- Schema changes: edit `db/schema.ts`, then `npx drizzle-kit generate --name <snake_case>`. Never hand-edit or apply migrations.
- Imports in TS use `.js` extensions (NodeNext).

## Non-obvious decisions

- The original brief asked for FastAPI + SQLite. It was implemented with Netlify Functions + Netlify Database so it deploys and persists on Netlify, and Zod stands in for Pydantic.
- `/api/demo` seeds fictional brands (PayNova, SkyCart, Orbit Bank) for hackathon demos. It's idempotent by brand name.
- The user's brief was cut off partway through the scanner section, so scanner fields beyond name/domain/handle (platform, app publisher, bio text) and the investigations workflow were inferred.
