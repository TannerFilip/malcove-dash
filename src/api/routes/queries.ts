import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../../db/client';
import { queries, queryRuns, hosts, hostObservations, hostQueryMatches } from '../../db/schema';
import { ShodanClient, type ShodanSearchMatch } from '../shodan';
import { bannerHash } from '../diff';
import { ENRICHMENT_SOURCES, type EnrichmentMessage } from '../../shared/queue-types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateQuerySchema = z.object({
  name: z.string().min(1).max(200),
  queryString: z.string().min(1),
  source: z.enum(['shodan', 'validin']),
  tags: z.array(z.string()).optional().default([]),
  schedule: z.string().optional(),
  maxResults: z.coerce.number().int().min(100).max(1000).default(100),
});

const MatchesQuerySchema = z.object({
  onlyChanged: z.string().optional(), // "true" | "false" | undefined
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shodan returns 100 results per search page. */
const PAGE_SIZE = 100;
/** Maximum pages to fetch per run (= up to 1000 hosts). */
const MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract cert/jarm fields from a Shodan search match for denormalised host columns.
 *  In search results each match is a single service — SSL is at the top level. */
function extractHostFields(match: ShodanSearchMatch) {
  // ASN comes as "AS12345" — strip the prefix
  const asnRaw = match.asn;
  const asn = asnRaw ? parseInt(asnRaw.replace(/^AS/i, ''), 10) : null;

  // SSL is directly on the search match (not nested in a services array)
  const ssl = match.ssl;
  const cert = ssl?.cert;
  const certSerial = cert?.serial != null ? String(cert.serial) : null;
  const certSubject = cert?.subject ? JSON.stringify(cert.subject) : null;
  const certIssuer = cert?.issuer ? JSON.stringify(cert.issuer) : null;
  const certFp = cert?.fingerprint?.sha256 ?? null;
  const jarm = ssl?.jarm ?? null;

  const hostname = match.hostnames?.[0] ?? null;

  return {
    asn: Number.isNaN(asn) ? null : asn,
    country: match.country_code ?? null,
    org: match.org ?? null,
    hostname,
    certSerial,
    certIssuer,
    certSubject,
    jarm,
    certFingerprint: certFp,
  };
}

interface BatchResult {
  newCount: number;
  changedCount: number;
  /** Hosts that are new or changed — candidates for enrichment. */
  toEnrich: Array<{ hostId: string; ip: string; port: number }>;
}

/** Process a batch of Shodan matches against the DB, returning new/changed counts. */
async function processBatch(
  db: ReturnType<typeof createDb>,
  batch: ShodanSearchMatch[],
  runId: string,
  now: number,
): Promise<BatchResult> {
  let newCount = 0;
  let changedCount = 0;
  const toEnrich: BatchResult['toEnrich'] = [];

  for (const match of batch) {
    const ip = match.ip_str;
    const port = match.port;
    const hostId = `${ip}:${port}`;
    const fields = extractHostFields(match);

    // Upsert host — preserve triageState/notes/snoozeUntil on conflict
    await db
      .insert(hosts)
      .values({
        id: hostId,
        ip,
        port,
        asn: fields.asn,
        country: fields.country,
        org: fields.org,
        hostname: fields.hostname,
        certSerial: fields.certSerial,
        certIssuer: fields.certIssuer,
        certSubject: fields.certSubject,
        jarm: fields.jarm,
        faviconHash: null,
        ja4x: null,
        triageState: 'new',
        snoozeUntil: null,
        notes: null,
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoUpdate({
        target: hosts.id,
        set: {
          asn: fields.asn,
          country: fields.country,
          org: fields.org,
          hostname: fields.hostname,
          certSerial: fields.certSerial,
          certIssuer: fields.certIssuer,
          certSubject: fields.certSubject,
          jarm: fields.jarm,
          lastSeen: now,
        },
      });

    // Compute banner hash
    const hash = await bannerHash(match);

    // Check most recent prior observation
    const [prior] = await db
      .select({ bannerHash: hostObservations.bannerHash })
      .from(hostObservations)
      .where(eq(hostObservations.hostId, hostId))
      .orderBy(desc(hostObservations.observedAt))
      .limit(1);

    const isNew = prior === undefined;
    const isChanged = !isNew && prior.bannerHash !== hash;

    if (isNew) newCount++;
    if (isChanged) changedCount++;
    if (isNew || isChanged) toEnrich.push({ hostId, ip, port });

    // Always append observation
    await db.insert(hostObservations).values({
      id: nanoid(),
      hostId,
      runId,
      observedAt: now,
      banner: match as unknown as Record<string, unknown>,
      bannerHash: hash,
      certFingerprint: fields.certFingerprint,
      source: 'shodan',
    });

    // Write match row (ignore conflict — idempotent re-run)
    await db
      .insert(hostQueryMatches)
      .values({ hostId, runId, isNew, isChanged })
      .onConflictDoNothing();
  }

  return { newCount, changedCount, toEnrich };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const queriesRouter = new Hono<{ Bindings: Env }>();

/** GET /api/queries — list all saved queries */
queriesRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(queries).orderBy(desc(queries.createdAt));
  return c.json({ data: rows });
});

/** POST /api/queries — create a saved query */
queriesRouter.post('/', zValidator('json', CreateQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const body = c.req.valid('json');

  const row = {
    id: nanoid(),
    name: body.name,
    queryString: body.queryString,
    source: body.source,
    tags: body.tags,
    schedule: body.schedule ?? null,
    maxResults: body.maxResults,
    lastRunAt: null,
  };

  await db.insert(queries).values(row);
  return c.json({ data: row }, 201);
});

/** GET /api/queries/:id — single query with run history */
queriesRouter.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');

  const [query] = await db.select().from(queries).where(eq(queries.id, id));
  if (!query) return c.json({ error: { code: 'NOT_FOUND', message: 'Query not found' } }, 404);

  const runs = await db
    .select()
    .from(queryRuns)
    .where(eq(queryRuns.queryId, id))
    .orderBy(desc(queryRuns.runAt));

  return c.json({ data: { ...query, runs } });
});

/** DELETE /api/queries/:id */
queriesRouter.delete('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');
  await db.delete(queries).where(eq(queries.id, id));
  return c.json({ data: { id } });
});

/**
 * GET /api/queries/:id/runs/:runId/matches
 * Returns paginated hosts for a run with isNew/isChanged flags and summary counts.
 * ?onlyChanged=true — filter to new + changed hosts only.
 */
queriesRouter.get('/:id/runs/:runId/matches', zValidator('query', MatchesQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const queryId = c.req.param('id');
  const runId = c.req.param('runId');
  const { onlyChanged: onlyChangedStr, page, pageSize } = c.req.valid('query');
  const onlyChanged = onlyChangedStr === 'true';

  // Verify run belongs to this query
  const [run] = await db
    .select()
    .from(queryRuns)
    .where(eq(queryRuns.id, runId));

  if (!run || run.queryId !== queryId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);
  }

  // Fetch all match records for this run
  const allMatches = await db
    .select({
      hostId: hostQueryMatches.hostId,
      isNew: hostQueryMatches.isNew,
      isChanged: hostQueryMatches.isChanged,
    })
    .from(hostQueryMatches)
    .where(eq(hostQueryMatches.runId, runId));

  const newCount = allMatches.filter((m) => m.isNew).length;
  const changedCount = allMatches.filter((m) => m.isChanged).length;
  const total = allMatches.length;
  const unchangedCount = total - newCount - changedCount;

  // Apply onlyChanged filter
  const filteredMatches = onlyChanged
    ? allMatches.filter((m) => m.isNew || m.isChanged)
    : allMatches;

  if (filteredMatches.length === 0) {
    return c.json({
      data: [],
      summary: { newCount, changedCount, unchangedCount, total },
      total: 0,
      page,
      pageSize,
    });
  }

  // Build a map for flag lookup
  const flagMap = new Map(allMatches.map((m) => [m.hostId, { isNew: m.isNew, isChanged: m.isChanged }]));

  // Paginate the filtered host IDs
  const offset = (page - 1) * pageSize;
  const pageIds = filteredMatches.slice(offset, offset + pageSize).map((m) => m.hostId);

  // Fetch host rows for this page
  // D1 parameter limit: fetch one-by-one if pageIds is small enough; for up to 50 it's fine
  const hostRows = await Promise.all(
    pageIds.map((hostId) =>
      db
        .select()
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .then((rows) => rows[0]),
    ),
  );

  const data = hostRows
    .filter((h): h is NonNullable<typeof h> => h !== undefined)
    .map((h) => ({
      ...h,
      isNew: flagMap.get(h.id)?.isNew ?? false,
      isChanged: flagMap.get(h.id)?.isChanged ?? false,
    }));

  return c.json({
    data,
    summary: { newCount, changedCount, unchangedCount, total },
    total: filteredMatches.length,
    page,
    pageSize,
  });
});

/**
 * POST /api/queries/:id/run — execute the query against Shodan.
 * Fetches up to MAX_PAGES pages (up to 1000 hosts total).
 */
queriesRouter.post('/:id/run', async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');

  const [query] = await db.select().from(queries).where(eq(queries.id, id));
  if (!query) return c.json({ error: { code: 'NOT_FOUND', message: 'Query not found' } }, 404);

  if (query.source !== 'shodan') {
    return c.json(
      { error: { code: 'NOT_IMPLEMENTED', message: 'Only Shodan queries supported in Phase 1-2' } },
      501,
    );
  }

  const runId = nanoid();
  const runAt = Math.floor(Date.now() / 1000);

  // Insert the run row immediately so we have an ID to reference
  await db.insert(queryRuns).values({
    id: runId,
    queryId: id,
    runAt,
    totalCount: null,
    newCount: null,
    changedCount: null,
    errorMessage: null,
  });

  try {
    const shodan = new ShodanClient(c.env.SHODAN_API_KEY, c.env.KV);
    const now = Math.floor(Date.now() / 1000);

    // -----------------------------------------------------------------------
    // Paginated fetch — capped at query.maxResults (default 100, max 1000)
    // Each page = 1 Shodan query credit.
    // -----------------------------------------------------------------------
    const maxResults = query.maxResults ?? 100;
    const maxPages = Math.ceil(maxResults / PAGE_SIZE); // e.g. 100→1, 300→3
    let allMatches: ShodanSearchMatch[] = [];
    let shodanTotal = 0;

    for (let page = 1; page <= maxPages; page++) {
      const result = await shodan.searchHosts(query.queryString, { page });

      if (page === 1) shodanTotal = result.total;
      allMatches.push(...result.matches);

      // Stop when we hit the user's limit, exhaust results, or get a partial page
      if (
        allMatches.length >= maxResults ||
        result.matches.length < PAGE_SIZE ||
        allMatches.length >= shodanTotal
      ) break;
    }

    // Enforce hard cap (in case of off-by-one on page boundaries)
    allMatches = allMatches.slice(0, maxResults);
    const truncated = shodanTotal > allMatches.length;

    // -----------------------------------------------------------------------
    // Process in batches of 25 — D1 has a ~100-parameter limit per statement
    // -----------------------------------------------------------------------
    const BATCH = 25;
    let totalNew = 0;
    let totalChanged = 0;
    const enrichQueue: Array<{ hostId: string; ip: string; port: number }> = [];

    for (let i = 0; i < allMatches.length; i += BATCH) {
      const batch = allMatches.slice(i, i + BATCH);
      const { newCount, changedCount, toEnrich } = await processBatch(db, batch, runId, now);
      totalNew += newCount;
      totalChanged += changedCount;
      enrichQueue.push(...toEnrich);
    }

    // -----------------------------------------------------------------------
    // Enqueue new/changed hosts for enrichment (rdns + full Shodan details)
    // Queue.sendBatch limit: 100 messages per call
    // -----------------------------------------------------------------------
    if (enrichQueue.length > 0) {
      const QUE_BATCH = 100;
      for (let i = 0; i < enrichQueue.length; i += QUE_BATCH) {
        await c.env.ENRICHMENT_QUEUE.sendBatch(
          enrichQueue.slice(i, i + QUE_BATCH).map((h) => ({
            body: {
              hostId: h.hostId,
              ip: h.ip,
              port: h.port,
              sources: [...ENRICHMENT_SOURCES],
            } satisfies EnrichmentMessage,
          })),
        );
      }
    }

    // Update run summary and query lastRunAt
    await db
      .update(queryRuns)
      .set({
        totalCount: allMatches.length,
        newCount: totalNew,
        changedCount: totalChanged,
      })
      .where(eq(queryRuns.id, runId));

    await db
      .update(queries)
      .set({ lastRunAt: runAt })
      .where(eq(queries.id, id));

    return c.json({
      data: {
        runId,
        totalCount: allMatches.length,
        shodanTotal,
        newCount: totalNew,
        changedCount: totalChanged,
        truncated,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(queryRuns)
      .set({ errorMessage: message })
      .where(eq(queryRuns.id, runId));
    throw err; // Let the error handler return 500
  }
});

export { queriesRouter };
