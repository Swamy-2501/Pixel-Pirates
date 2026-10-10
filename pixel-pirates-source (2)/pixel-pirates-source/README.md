# Pixel Pirates

**Protect Your Brand. Detect Digital Threats.**

Pixel Pirates is a digital-risk-protection platform built by team **Pixel Pirates** for **HackXLerate 2026** (Cybersecurity / Digital Risk Protection). It helps businesses find suspicious social media profiles, fake company pages, lookalike domains, scam accounts and malicious apps that impersonate a real brand.

## Features

- **Landing page:** branding, feature overview, how it works, team and event info.
- **SOC dashboard:** live counts of brands, scans, suspicious and high-risk candidates and open investigations, all calculated from the database. Also includes a 14-day scan trend, a risk-distribution chart, recent scans, most-targeted brands, an activity feed and quick actions. When the database is empty it shows a guided empty state with an optional one-click demo dataset.
- **Brand registry:** add, search, filter, sort, edit and delete official brands (name, domain, social handle, app publisher, optional contact email). Fields are validated and normalised on both client and server, duplicates are rejected, and timestamps are shown.
- **Digital risk scanner:** compares a candidate against a brand's official assets and returns an explainable 0–100 score (Low / Medium / High / Critical), a verdict and a list of weighted signals. Every scan is saved to a filterable history.
- **Investigations:** a Kanban case board (Open → In progress → Takedown requested → Closed) with priority, status and analyst notes. Cases can be opened from a scan report or logged by hand.
- **Notifications and audit trail:** every registration, scan and case change is written to an activity log.

### Detection techniques

Typosquatting (edit distance), homoglyph swaps (`0→o`, `rn→m`, `1→l`…), combosquatting (`brand-support.com`), brand-as-subdomain abuse (`brand.com.secure-verify.top`), same name on a different TLD, punycode/IDN domains, high-abuse TLDs, phishing keywords, impersonation-style handles (`_official`, `_support`, `_care`…), lookalike or mismatched app publishers, scam language (OTP/credential requests, crypto, giveaways, off-platform DMs, urgency, untraceable payments, APK sideloading) and URL shorteners. Exact matches with official assets lower the score.

## Technology

| Layer | Tech |
| --- | --- |
| Frontend | HTML5, CSS3, vanilla JavaScript (ES modules), Chart.js, Lucide icons |
| API | REST endpoints on Netlify Functions (TypeScript), input validation with Zod |
| Database | Netlify Database (managed Postgres) via Drizzle ORM |
| Hosting | Netlify |

> **Why not FastAPI + SQLite?** The app is hosted on Netlify, which runs serverless JavaScript/TypeScript functions rather than long-running Python servers, and a SQLite file wouldn't persist between serverless requests. The architecture is the same (REST API, schema validation, relational database), only on platform-native pieces: Zod plays the role of Pydantic and Postgres replaces SQLite.

### REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/brands` | List (`?q=`) / register brands |
| GET / PUT / DELETE | `/api/brands/:id` | Read / edit / delete a brand |
| GET / POST | `/api/scans` | Scan history (`?q=&brandId=&level=high,critical`) / run a scan |
| GET / DELETE | `/api/scans/:id` | Scan report / delete |
| GET / POST | `/api/investigations` | List / open a case (`{ scanId }` or `{ brandId, title }`) |
| GET / PATCH / DELETE | `/api/investigations/:id` | Read / update status, priority, notes / delete |
| GET | `/api/stats` | Dashboard aggregates |
| GET | `/api/activity` | Activity log |
| POST | `/api/demo` | Load a fictional demo dataset |

## Running locally (Windows / macOS / Linux, e.g. in VS Code)

1. Install [Node.js 20+](https://nodejs.org) and the Netlify CLI: `npm install -g netlify-cli`
2. In the project folder: `npm install`
3. Link the folder to the Netlify project (once): `netlify link`
4. Start the dev server: `npm run dev` (runs `netlify dev`), then open the URL it prints.

`netlify dev` serves the static frontend from `public/`, runs the API functions and connects to the database.

### Changing the database schema

Edit `db/schema.ts`, then run `npx drizzle-kit generate --name <describe_change>`. Migrations in `netlify/database/migrations/` are applied automatically on deploy.

## Project structure

```
public/            Static frontend (one HTML page per screen + css/ + js/)
netlify/functions/ REST API endpoints
lib/               Risk engine, validation, normalisation, HTTP helpers
db/                Drizzle schema + client
netlify/database/migrations/  Generated SQL migrations
```
