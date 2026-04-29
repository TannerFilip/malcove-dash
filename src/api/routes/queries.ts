import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../../db/client';
import { queries, queryRuns, hosts, hostObservations, hostQueryMatches } from '../../db/schema';
import { ShodanClient } from '../shodan';
import { bannerHash } from '../diff';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateQuerySchema = z.object({
  name: z.string().min(1).max(200),
  queryString: z.string().min(1),
  source: z.enum(['shodan', 'validin']),
  tags: z.array(z.string()).optional().default([]),
  schedule: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract cert/jarm fields from a Shodan match for denormalised host columns. */
function extractHostFields(match: Record<string, unknown>) {
  // ASN comes as "AS12345" — strip the prefix
  const asnRaw = match['asn'] as string | undefined;
  const asn = asnRaw ? parseInt(asnRaw.replace(/^AS/i, ''), 10) : null;

  // Prefer service-level SSL, fall back to host-level
  const services = (match['data'] as Array<Record<string, unknown>> | undefined) ?? [];
  const firstSsl =
    (services.find((s) => s['ssl'])?.['ssl'] as Record<string, unknown> | undefined) ??
    (match['ssl'] as Record<string, unknown> | undefined);

  const cert = firstSsl?.['cert'] as Record<string, unknown> | undefined;
  const certSerial = cert?.['serial'] != null ? String(cert['serial']) : null;
  const certSubject = cert?.['subject']
    ? JSON.stringify(cert['subject'])
    : null;
  const certIssuer = cert?.['issuer'] ? JSON.stringify(cert['issuer']) : null;
  const certFp =
    (cert?.['fingerprint'] as Record<string, unknown> | undefined)?.['sha256'] as
      | string
      | undefined ?? null;
  const jarm = firstSsl?.['jarm'] as string | undefined ?? null;

  const hostnames = match['hostnames'] as string[] | undefined;
  const hostname = hostnames?.[0] ?? null;

  return {
    asn: Number.isNaN(asn) ? null : asn,
    country: (match['country_code'] as string | undefined) ?? null,
    org: (match['org'] as string | undefined) ?? null,
    hostname,
    certSerial,
    certIssuer,
    certSubject,
    jarm,
    certFingerprint: certFp,
  };
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

/** POST /api/queries/:id/run — execute the query against Shodan */
queriesRouter.post('/:id/run', async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');

  const [query] = await db.select().from(queries).where(eq(queries.id, id));
  if (!query) return c.json({ error: { code: 'NOT_FOUND', message: 'Query not found' } }, 404);

  if (query.source !== 'shodan') {
    return c.json(
      { error: { code: 'NOT_IMPLEMENTED', message: 'Only Shodan queries supported in Phase 1' } },
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

    // Fetch page 1 (Phase 2 adds pagination loop)
    const result = await shodan.searchHosts(query.queryString, { page: 1 });
    const matches = result.matches;

    let newCount = 0;
    let changedCount = 0;
    const now = Math.floor(Date.now() / 1000);

    // Process in batches of 25 to respect D1's 100-parameter limit
    const BATCH = 25;

    for (let i = 0; i < matches.length; i += BATCH) {
      const batch = matches.slice(i, i + BATCH);

      for (const match of batch) {
        const ip = match.ip_str;
        const port = match.port;
        const hostId = `${ip}:${port}`;
        const fields = extractHostFields(match as unknown as Record<string, unknown>);

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
    }

    // Update run summary and query lastRunAt
    await db
      .update(queryRuns)
      .set({
        totalCount: matches.length,
        newCount,
        changedCount,
      })
      .where(eq(queryRuns.id, runId));

    await db
      .update(queries)
      .set({ lastRunAt: runAt })
      .where(eq(queries.id, id));

    return c.json({
      data: {
        runId,
        totalCount: matches.length,
        newCount,
        changedCount,
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
