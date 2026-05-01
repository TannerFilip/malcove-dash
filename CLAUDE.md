# Build: Shodan/Validin Threat Infrastructure Triage Dashboard

## Context

You are building a personal threat infrastructure triage dashboard for a SOC analyst doing personal threat-hunting research. The user runs Shodan and Validin queries hunting for malicious infrastructure (C2 panels, stealer panels, AiTM kits, abusive RMM deployments, open directories, etc.) and the workflow currently breaks because they keep re-reviewing the same hosts when they re-run saved queries.

The dashboard's job is to:
1. Save and rerun queries with **diff-on-rerun** (only show new/changed hosts since last run)
2. Triage hosts (new / reviewing / notable / dismissed / false-positive / monitoring / needs-followup)
3. Auto-enrich hosts (rDNS, ASN, cert, JARM, favicon hash, screenshot)
4. Change-detect notable hosts nightly (cert rotation, JARM change, new ports)
5. Track pivots between hosts (cert serial, JARM, favicon hash, ASN+port) — the graph builds itself as the user pivots
6. Single-user, deployed entirely on Cloudflare's stack

## Tech stack — these are decisions, not suggestions

- **Hosting**: Cloudflare Pages with Pages Functions (single project, no separate Worker for the API)
- **Frontend**: Vite + React 18 + TypeScript + Tailwind + TanStack Query + TanStack Router
- **API**: Hono (mounted under `functions/api/[[path]].ts`)
- **DB**: D1 (Cloudflare's SQLite) with **Drizzle ORM** + `drizzle-kit` for migrations
- **Object storage**: R2 for screenshots and archived raw banner blobs
- **KV**: For Shodan API quota counters and short-TTL response caching
- **Background work**: Cloudflare Queues + Cron Triggers
- **Auth**: Cloudflare Access (zero code — configured in CF dashboard, GitHub IdP). For programmatic POSTs from external workers, use Access Service Tokens.
- **Validation**: Zod everywhere at the API boundary

**Do NOT use Refine.** The user already has Refine experience from another project (Connectracker) and explicitly wants a leaner setup here because the keyboard-driven triage UX fights admin-scaffold patterns.

**Do NOT build custom auth.** Cloudflare Access handles it. Read the `Cf-Access-Authenticated-User-Email` header in middleware if you need user identity, but for single-user mode you can skip even that.

**Plan**: The user is on **Workers Paid ($5/mo)**. Relevant headroom vs. free tier: 1000 subrequests per request (not 50), CPU time configurable up to 5 minutes via `limits.cpu_ms`, Queues available (they aren't on free), D1 at 5GB/db, R2 with 10GB included. Take advantage where it simplifies code — see the gotchas section.

## Architecture

```
Cloudflare Access (GitHub SSO) gates everything
    │
    ▼
Pages (Vite-built SPA) ◄────► Pages Functions (Hono API)
                                    │
                                    ├──► D1 (main store)
                                    ├──► R2 (screenshots, archived banners)
                                    ├──► KV (quota, cache)
                                    └──► Queue producer (enrich-jobs)

Cron Trigger ──► Queue ──► Consumer Worker
                              │
                              ├──► Shodan API
                              ├──► Validin API
                              ├──► Favicon fetches, rDNS
                              └──► D1 (write back observations)

External (homelab/VPS workers — not in this repo):
   JARM / JA4X / TLS-fingerprinting daemons
       └── POST results to /api/enrichments (auth: Access Service Token)
```

**Design rule**: anything Workers can't do (raw TLS handshakes for JARM, port scans, long-lived sockets) is out of scope for this repo. Those run elsewhere and POST results in. Keep the dashboard as the system of record; let external producers be dumb.

## Repository layout

```
malcove-dash/
├── functions/
│   └── api/
│       └── [[path]].ts          # Hono app entry, routes mounted from src/api/
├── src/
│   ├── api/                     # Server-side (runs in Workers)
│   │   ├── routes/
│   │   │   ├── queries.ts
│   │   │   ├── hosts.ts
│   │   │   ├── observations.ts
│   │   │   ├── pivots.ts
│   │   │   ├── tags.ts
│   │   │   └── enrichments.ts
│   │   ├── shodan.ts            # Shodan client (fetch-based)
│   │   ├── validin.ts           # Validin client
│   │   ├── enrichment.ts        # Job producer + consumer logic
│   │   ├── diff.ts              # Diff-on-rerun core
│   │   └── middleware.ts        # Auth, error handling, validation
│   ├── db/
│   │   ├── schema.ts            # Drizzle schema (single source of truth)
│   │   ├── client.ts            # Drizzle client factory
│   │   └── migrations/          # drizzle-kit output
│   ├── workers/
│   │   ├── queue-consumer.ts    # Enrichment queue consumer
│   │   └── cron.ts              # Nightly recheck producer
│   ├── ui/                      # Client-side React
│   │   ├── routes/              # TanStack Router routes
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── main.tsx
│   └── shared/
│       └── types.ts             # Types shared between API and UI
├── drizzle.config.ts
├── wrangler.toml
├── vite.config.ts
├── tailwind.config.ts
├── package.json
└── README.md
```

## Database schema (Drizzle, TypeScript)

This is the canonical schema — implement it exactly in `src/db/schema.ts`:

```ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const queries = sqliteTable('queries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  queryString: text('query_string').notNull(),
  source: text('source', { enum: ['shodan', 'validin'] }).notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  schedule: text('schedule'),                            // cron expr or null
  lastRunAt: integer('last_run_at'),                     // unix seconds
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const queryRuns = sqliteTable('query_runs', {
  id: text('id').primaryKey(),
  queryId: text('query_id').notNull().references(() => queries.id, { onDelete: 'cascade' }),
  runAt: integer('run_at').notNull(),
  totalCount: integer('total_count'),
  newCount: integer('new_count'),
  changedCount: integer('changed_count'),
  rawResponseKey: text('raw_response_key'),              // R2 key
  errorMessage: text('error_message'),
}, (t) => ({
  queryIdx: index('idx_runs_query').on(t.queryId, t.runAt),
}));

export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),                           // `${ip}:${port}`
  ip: text('ip').notNull(),
  port: integer('port').notNull(),
  asn: integer('asn'),
  country: text('country'),
  org: text('org'),
  hostname: text('hostname'),
  certSerial: text('cert_serial'),
  certIssuer: text('cert_issuer'),
  certSubject: text('cert_subject'),
  jarm: text('jarm'),
  faviconHash: text('favicon_hash'),
  ja4x: text('ja4x'),
  triageState: text('triage_state', {
    enum: ['new', 'reviewing', 'notable', 'dismissed', 'false_positive', 'monitoring', 'needs_followup'],
  }).notNull().default('new'),
  snoozeUntil: integer('snooze_until'),
  notes: text('notes'),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
}, (t) => ({
  triageIdx: index('idx_hosts_triage').on(t.triageState, t.lastSeen),
  asnIdx: index('idx_hosts_asn').on(t.asn),
  certIdx: index('idx_hosts_cert').on(t.certSerial),
  jarmIdx: index('idx_hosts_jarm').on(t.jarm),
  faviconIdx: index('idx_hosts_favicon').on(t.faviconHash),
  snoozeIdx: index('idx_hosts_snooze').on(t.snoozeUntil),
}));

export const hostObservations = sqliteTable('host_observations', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  runId: text('run_id').references(() => queryRuns.id, { onDelete: 'set null' }),
  observedAt: integer('observed_at').notNull(),
  banner: text('banner', { mode: 'json' }).notNull(),    // raw provider blob
  bannerHash: text('banner_hash').notNull(),             // sha256 hex of canonicalized banner
  certFingerprint: text('cert_fingerprint'),
  source: text('source', { enum: ['shodan', 'validin', 'recheck', 'external'] }).notNull(),
}, (t) => ({
  hostTimeIdx: index('idx_obs_host_time').on(t.hostId, t.observedAt),
  hashIdx: index('idx_obs_hash').on(t.bannerHash),
}));

export const hostQueryMatches = sqliteTable('host_query_matches', {
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => queryRuns.id, { onDelete: 'cascade' }),
  isNew: integer('is_new', { mode: 'boolean' }).notNull(),
  isChanged: integer('is_changed', { mode: 'boolean' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.hostId, t.runId] }),
  runIdx: index('idx_matches_run').on(t.runId),
}));

export const pivots = sqliteTable('pivots', {
  id: text('id').primaryKey(),
  fromHostId: text('from_host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  toHostId: text('to_host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  pivotType: text('pivot_type', {
    enum: ['cert_serial', 'jarm', 'favicon_hash', 'ja4x', 'asn_port', 'cert_subject', 'manual'],
  }).notNull(),
  pivotValue: text('pivot_value'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => ({
  fromIdx: index('idx_pivots_from').on(t.fromHostId),
  toIdx: index('idx_pivots_to').on(t.toHostId),
}));

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const hostTags = sqliteTable('host_tags', {
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.hostId, t.tagId] }),
}));

export const enrichments = sqliteTable('enrichments', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),                      // 'rdns' | 'asn_history' | 'jarm' | 'ja4x' | 'favicon' | 'screenshot' | 'validin' | etc.
  data: text('data', { mode: 'json' }).notNull(),
  fetchedAt: integer('fetched_at').notNull(),
}, (t) => ({
  hostSourceIdx: index('idx_enrich_host_source').on(t.hostId, t.source),
}));
```

**ID convention**: use `nanoid()` for surrogate keys. Use `${ip}:${port}` as the natural key for `hosts` to dedupe automatically.

**Banner hash**: canonicalize JSON keys (recursive sort) before hashing so equivalent objects with different key order produce the same hash. Hash with SubtleCrypto / sha-256. This is the foundation of change detection — get it right.

## Phased build with checkpoints

Work through these phases in order. **Stop after each phase, summarize what's done, and ask the user to verify before moving on.** Do not blast through the whole thing.

### Phase 0 — Bootstrap

1. `npm create cloudflare@latest malcove-dash` — pick the React + Vite + Pages Functions template
2. Install: `drizzle-orm`, `drizzle-kit`, `hono`, `@hono/zod-validator`, `zod`, `nanoid`, `@tanstack/react-query`, `@tanstack/react-router`, `tailwindcss`
3. Configure `drizzle.config.ts` for D1
4. Create the schema in `src/db/schema.ts` (full schema above — implement it all in this phase)
5. Run `wrangler d1 create malcove-dash` and wire the binding into `wrangler.toml`
6. Generate and apply the initial migration: `drizzle-kit generate` then `wrangler d1 migrations apply malcove-dash --local` and `--remote`
7. Hello-world Hono route at `/api/health` returning `{ ok: true, ts: <unix> }` from a real D1 read
8. Confirm `wrangler pages dev` works locally and a deployed Pages preview returns the same

**Checkpoint**: User runs `npm run dev`, hits `/api/health`, sees the OK response. Stop here.

### Phase 1 — Core triage slice

The minimum end-to-end loop: save a Shodan query, run it, see hosts, triage them.

- `POST /api/queries` — create a saved query (Zod-validated)
- `POST /api/queries/:id/run` — execute against Shodan, upsert hosts and observations, write `host_query_matches` rows, return run summary
- `GET /api/hosts` — list with filters: `triageState`, `asn`, `queryId`, `runId`, `tag`, pagination
- `GET /api/hosts/:id` — full detail including observations and enrichments
- `PATCH /api/hosts/:id` — update triage state, notes, snooze
- Shodan client in `src/api/shodan.ts`: `searchHosts(query, { page })` — uses `SHODAN_API_KEY` from env, increments KV quota counter on each call
- UI: route `/queries` (list + create), `/queries/:id` (run history + run button), `/hosts` (filterable table), `/hosts/:id` (detail + triage controls)
- **Keyboard nav from day one**: `j`/`k` to move selection in host list, `1`-`7` for triage states, `n` to focus notes, `t` for tags, `/` for search, `?` for shortcut help. Use a global hotkey hook, don't sprinkle handlers.
- Banner JSON pretty-printed with collapsible sections in detail view

**Checkpoint**: User saves a query, runs it, sees real Shodan results in the table, can triage them with the keyboard. Stop here.

### Phase 2 — Diff-on-rerun

The headline feature. When `POST /api/queries/:id/run` executes:

1. Fetch current results from Shodan
2. For each result, compute `bannerHash` (canonicalized sha-256)
3. Look up the most recent prior observation for the same `host_id`
4. Mark the match `isNew: true` if no prior observation exists, `isChanged: true` if a prior observation exists with a different hash, both false if unchanged
5. Persist the new observation row regardless (append-only)
6. Update `query_runs.newCount` and `changedCount`

UI changes:
- Run-results view defaults to `isNew=true OR isChanged=true` filter
- Pill summary at top: `12 new · 4 changed · 84 unchanged`
- Toggle to show all
- "Changes" view on a host detail page diffs the latest two observations field-by-field (cert serial, ports, title, banner)

**Checkpoint**: User reruns a saved query, sees only new/changed hosts by default, can drill into a changed host and see what differed. Stop here.

### Phase 3 — Enrichment pipeline

- Define a `EnrichmentJob` type: `{ hostId, kind: 'favicon' | 'rdns' | 'shodan_host' | 'asn_history', priority }`
- `wrangler.toml` queue producer + consumer bindings
- Queue producer: on host insert from a query run, enqueue jobs for each enrichment kind the host doesn't already have
- Consumer worker (`src/workers/queue-consumer.ts`): processes batches, writes to `enrichments` table, idempotent
- `POST /api/enrichments` endpoint for external producers (JARM, JA4X) — auth via Access Service Token header check
- UI: enrichments shown as a panel on host detail with "fetched at" timestamps, manual "refetch" button

**Checkpoint**: New hosts auto-enrich; user can also POST a JARM result with curl + service token and see it appear. Stop here.

### Phase 4 — Change detection

- Cron Trigger fires nightly (`0 6 * * *` UTC, configurable later)
- Cron handler enqueues recheck jobs for hosts where `triageState IN ('notable', 'monitoring', 'needs_followup')` OR `snoozeUntil <= now`
- Recheck consumer fetches Shodan host details, computes new banner hash, compares to last observation, writes new observation row, flags deltas
- New `GET /api/changes` endpoint returns recent observation deltas with diff summaries
- UI: "Changes" feed (top-level route) showing cert rotations, JARM changes, port additions, with quick-action buttons
- Snooze auto-resurface: cron also flips `triageState` of expired snoozes back to `reviewing`

**Checkpoint**: User snoozes a host for 1 minute (via dev override), waits, confirms it resurfaces with any changes flagged. Stop here.

### Phase 5 — Pivots and Validin

- Validin client in `src/api/validin.ts`
- Validin proxy routes (`/api/validin/...`) with API key server-side
- "Find related" actions on host detail: by cert serial, JARM, favicon hash, JA4X, ASN+port. Each runs the appropriate query, creates `pivots` rows linking source host to results, returns the new hosts
- Simple pivot view: `/hosts/:id/pivots` lists pivots out and pivots in, grouped by `pivotType`
- (Optional, do last) graph viz with `react-force-graph-2d` or similar — only if it adds value; the list view is often enough

**Checkpoint**: User pivots from a notable host by cert serial, sees related hosts appear with the pivot recorded. Stop here.

### Phase 6 — Polish

- Bulk ops: select multiple hosts in the table, bulk dismiss / tag / change state. Watch the D1 100-param batch limit — chunk into batches of 50.
- Per-query hit-rate stats: `% notable / % dismissed / total` over time, surfaced on the queries list
- Saved filter views (store as user preferences in D1)
- Export: selected hosts → JSON or STIX 2.1 bundle download
- FTS5 virtual table over `hosts.notes` and `host_observations.banner` if search performance demands it
- Quota dashboard: Shodan credits used this month, pulled from KV counter

## Cloudflare-specific gotchas to internalize

- **D1 has a 100-bound-parameter limit per statement**. Drizzle won't warn you; you'll hit it on bulk inserts. Chunk inserts into batches of ≤25 rows (assume ~4 columns per row).
- **D1 has a 1MB response size limit per query**. For large result sets, paginate at the SQL layer (`LIMIT/OFFSET` or cursor).
- **Workers CPU limits (Paid plan)**: default is 30s, but you can raise it to 300s (5 min) via `limits.cpu_ms` in `wrangler.toml`. Set this on the queue consumer Worker so batch enrichment has headroom; leave the API at the default.
- **Subrequest cap is 1000** on Paid (vs. 50 on free). A query run that paginates ~10 pages of Shodan results inline is fine. Push to the queue only for unusually large runs (e.g. >50 pages) or anything that needs durability across failures.
- **Cron Triggers don't pass arguments**. The cron handler enqueues jobs; the queue consumer does the work.
- **Queues retry on exception**. Make consumers idempotent: deterministic job IDs, upserts not inserts where possible. Configure DLQ for poison-message handling.
- **`wrangler pages dev` with `--local` uses a local SQLite file for D1**. Apply migrations with `--local` first, then `--remote` for production.
- **Secrets via `wrangler secret put`**, never in `wrangler.toml`. Required: `SHODAN_API_KEY`, `VALIDIN_API_KEY`, `ENRICHMENT_INGEST_TOKEN` (for the external POST endpoint as a fallback if not using Access Service Tokens).
- **R2 object keys**: use `runs/${runId}.json` for archived raw responses, `screenshots/${hostId}/${observedAt}.png` for screenshots. Don't put userland data in keys (no IPs in URLs that get logged).
- **Cloudflare Access in dev**: Access doesn't apply to `wrangler pages dev`. Add a dev-only middleware shim that simulates the `Cf-Access-Authenticated-User-Email` header.

## Code style and conventions

- TypeScript strict mode on, no `any` (use `unknown` and narrow)
- Zod schemas for every API request body and every external API response shape
- All timestamps as Unix seconds (integer), never strings, never milliseconds
- Drizzle types are the source of truth — derive UI types from them via `InferSelectModel<typeof hosts>` etc., re-exported from `src/shared/types.ts`
- No default exports except where a framework requires them (route files for some routers)
- Error responses follow `{ error: { code: string, message: string, details?: unknown } }` shape consistently
- React: functional components only, server state via TanStack Query, local UI state via `useState`/`useReducer`. No Redux, no Zustand unless something genuinely needs it.
- Tailwind only for styling. No CSS modules, no styled-components.

## Initial task

Start with **Phase 0** only. Do not begin Phase 1 until the user confirms Phase 0 works end-to-end. After scaffolding, summarize:

- What files were created
- Exact commands the user needs to run (D1 create, secret put, migrations apply)
- The values they need to copy from `wrangler d1 create` output into `wrangler.toml`
- How to verify `/api/health` returns OK both locally and on a Pages preview deploy

Then stop and wait.