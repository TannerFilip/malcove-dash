# malcove-dash

A personal SOC analyst dashboard for hunting and triaging malicious infrastructure — C2 panels, stealer panels, AiTM kits, abusive RMM deployments, open directories, and similar threats — using Shodan and Validin as data sources.

Built for one analyst on Cloudflare's stack. Not multi-tenant.

## What it does

- **Saved queries with diff-on-rerun.** Save a Shodan or Validin query, run it on demand, and only see hosts that are new or whose banners changed since the last run.
- **Triage workflow.** Move hosts through 7 states (`new`, `reviewing`, `notable`, `dismissed`, `false_positive`, `monitoring`, `needs_followup`) with full keyboard navigation.
- **Background enrichment.** A queue worker auto-fetches reverse DNS and full Shodan host detail for every host that lands in the table.
- **Nightly recheck.** A cron worker re-fetches monitored / notable / reviewing hosts and surfaces cert rotations, JARM changes, and other banner diffs.
- **Pivots.** From any host, pivot by certificate serial, JARM, favicon hash, JA4X, or ASN+port.
- **Passive DNS.** Look up pDNS for any IP or domain via a Validin proxy endpoint.
- **Quota awareness.** Live Shodan quota dashboard backed by a KV counter and the Shodan `/api-info` endpoint.

## Stack

| Layer | Choice |
|---|---|
| Hosting | Cloudflare Pages + Pages Functions |
| Frontend | Vite, React 19, TypeScript, Tailwind, TanStack Query, TanStack Router |
| API | Hono mounted under `functions/api/[[path]].ts` |
| DB | D1 (SQLite) via Drizzle ORM |
| Object storage | R2 (reserved for screenshots / archived banners) |
| KV | Shodan quota counters |
| Background | Cloudflare Queues + Cron Triggers (separate Worker) |
| Auth | Cloudflare Access (GitHub SSO) — no in-app auth code |
| Validation | Zod at every API boundary |

## Repository layout

```
malcove-dash/
├── functions/api/[[path]].ts     # Hono entrypoint for Pages Functions
├── src/
│   ├── api/                      # Hono app, routes, external API clients
│   ├── db/                       # Drizzle schema, client factory, migrations
│   ├── shared/                   # Types and pure helpers shared by UI + workers
│   ├── workers/                  # Queue consumer + cron handler (separate Worker)
│   └── ui/                       # React app (routes, components, hooks)
├── drizzle.config.ts
├── wrangler.toml                 # Pages project bindings
└── vite.config.ts
```

The full file-by-file map lives in [CLAUDE.md](CLAUDE.md).

## Two-Worker model

There are two Cloudflare Workers in this project:

1. **Pages Functions** (`wrangler.toml`) — serves the Hono API at `/api/*` alongside the static frontend.
2. **Enrichment Worker** (`src/workers/wrangler.worker.toml`) — queue consumer plus cron handler. Deployed independently.

Cron schedule on the enrichment worker:
- `0 2 * * *` — enqueue stale hosts for re-enrichment
- `0 4 * * *` — recheck monitoring / notable / reviewing hosts for banner changes

## Development

Initial setup:

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in API keys (see below)
npx wrangler d1 migrations apply malcove-dash --local
```

Required `.dev.vars` (project root, never commit):

```
SHODAN_API_KEY=your_key
VALIDIN_API_KEY=your_key
ENRICHMENT_INGEST_TOKEN=any_random_string
```

Day-to-day:

```bash
npm run dev                                                          # Vite (5173) + wrangler proxy (8788)
npx wrangler dev --config src/workers/wrangler.worker.toml           # enrichment worker (separate terminal)
```

Trigger the cron locally:

```bash
curl "http://localhost:8787/__scheduled?cron=0+4+*+*+*"
```

After a schema change:

```bash
npx drizzle-kit generate
npx wrangler d1 migrations apply malcove-dash --local
```

## Deployment

```bash
npm run build
npx wrangler pages deploy dist
npx wrangler deploy --config src/workers/wrangler.worker.toml
```

Production secrets must be set on **both** Workers:

```bash
wrangler secret put SHODAN_API_KEY
wrangler secret put VALIDIN_API_KEY
wrangler secret put ENRICHMENT_INGEST_TOKEN
# repeat each with --config src/workers/wrangler.worker.toml
```

Apply pending migrations to production D1:

```bash
npx wrangler d1 migrations apply malcove-dash --remote
```

## API surface

```
GET    /api/health
GET    /api/queries
POST   /api/queries
GET    /api/queries/:id
DELETE /api/queries/:id
POST   /api/queries/:id/run
GET    /api/queries/:id/runs/:runId/matches
GET    /api/hosts
GET    /api/hosts/:id
PATCH  /api/hosts/:id
GET    /api/hosts/:id/pivots
POST   /api/hosts/:id/pivots
GET    /api/runs/:runId
POST   /api/enrichments
POST   /api/enrichments/ingest
GET    /api/changes
GET    /api/validin/ip/:ip/pdns
GET    /api/validin/domain/:domain/pdns
GET    /api/quota
```

Errors are returned as `{ error: { code, message, details? } }`.

## Keyboard shortcuts (hosts table)

| Key | Action |
|---|---|
| `j` / `k` | Move selection down / up |
| `1`–`7` | Set triage state |
| `n` | Focus notes textarea |
| `/` | Focus search |
| `?` | Toggle shortcut help overlay |

## Conventions

- TypeScript strict, no `any`
- Zod validates every request body and every external API response
- All timestamps are Unix seconds (integer)
- Drizzle types are the source of truth — UI types derive via `InferSelectModel`
- `nanoid()` for surrogate IDs; `${ip}:${port}` for `hosts.id`
- `host_observations` is append-only — never updated, always inserted
- Tailwind only for styling

## License

ISC
