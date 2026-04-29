import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../../db/client';
import { hosts, enrichments } from '../../db/schema';
import { ENRICHMENT_SOURCES, type EnrichmentMessage } from '../../shared/queue-types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EnqueueSchema = z.object({
  /** Host to enrich — must exist in the hosts table. */
  hostId: z.string().min(1),
  /** Which jobs to run; defaults to all supported sources. */
  sources: z.array(z.enum(ENRICHMENT_SOURCES as [string, ...string[]])).optional(),
});

const IngestSchema = z.object({
  /** "${ip}:${port}" primary key */
  hostId: z.string().min(1),
  /** Source identifier, e.g. "rdns", "validin", custom strings */
  source: z.string().min(1).max(64),
  /** Arbitrary enrichment payload */
  data: z.record(z.string(), z.unknown()),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const enrichmentsRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/enrichments — manually enqueue enrichment job(s) for a host.
 * Requires Cloudflare Access authentication (handled by devAccessShim in dev).
 */
enrichmentsRouter.post('/', zValidator('json', EnqueueSchema), async (c) => {
  const db = createDb(c.env.DB);
  const { hostId, sources } = c.req.valid('json');

  // Verify host exists
  const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, hostId));
  if (!host) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);
  }

  const [ip, portStr] = hostId.split(':') as [string, string];
  const port = parseInt(portStr, 10);

  const message: EnrichmentMessage = {
    hostId,
    ip,
    port: Number.isNaN(port) ? 0 : port,
    sources: (sources as typeof ENRICHMENT_SOURCES) ?? [...ENRICHMENT_SOURCES],
  };

  await c.env.ENRICHMENT_QUEUE.send(message);

  return c.json({ data: { queued: true, hostId, sources: message.sources } });
});

/**
 * POST /api/enrichments/ingest — external enrichment data push.
 *
 * Used by scripts, integrations, or other tools that compute enrichment data
 * outside Cloudflare (e.g. a local JARM scanner, VirusTotal lookups, etc.)
 * and want to push it into the dashboard.
 *
 * Auth: `Authorization: Bearer <ENRICHMENT_INGEST_TOKEN>` (not Cloudflare Access).
 */
enrichmentsRouter.post('/ingest', zValidator('json', IngestSchema), async (c) => {
  // Token auth — bypass Cloudflare Access for machine-to-machine calls
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token || token !== c.env.ENRICHMENT_INGEST_TOKEN) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token' } }, 401);
  }

  const db = createDb(c.env.DB);
  const { hostId, source, data } = c.req.valid('json');

  // Verify host exists — reject pushes for unknown hosts
  const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, hostId));
  if (!host) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);
  }

  const row = {
    id: nanoid(),
    hostId,
    source,
    data,
    fetchedAt: Math.floor(Date.now() / 1000),
  };

  await db.insert(enrichments).values(row);

  return c.json({ data: { id: row.id } }, 201);
});

export { enrichmentsRouter };
