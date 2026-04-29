import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { createDb } from '../../db/client';
import { hosts, hostObservations, hostQueryMatches, hostTags, tags, enrichments } from '../../db/schema';
import { TRIAGE_STATES } from '../../shared/types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const HostsQuerySchema = z.object({
  triageState: z.enum(TRIAGE_STATES).optional(),
  asn: z.coerce.number().optional(),
  runId: z.string().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

const PatchHostSchema = z.object({
  triageState: z.enum(TRIAGE_STATES).optional(),
  notes: z.string().optional(),
  snoozeUntil: z.number().int().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const hostsRouter = new Hono<{ Bindings: Env }>();

/** GET /api/hosts — paginated, filterable host list */
hostsRouter.get('/', zValidator('query', HostsQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const { triageState, asn, runId, tag, page, pageSize } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  // Build where conditions
  const conditions = [];

  if (triageState) {
    conditions.push(eq(hosts.triageState, triageState));
  }
  if (asn !== undefined) {
    conditions.push(eq(hosts.asn, asn));
  }

  // Filter by runId via hostQueryMatches join
  if (runId) {
    const matchedIds = await db
      .select({ hostId: hostQueryMatches.hostId })
      .from(hostQueryMatches)
      .where(eq(hostQueryMatches.runId, runId));
    const ids = matchedIds.map((m) => m.hostId);
    if (ids.length === 0) {
      return c.json({ data: [], total: 0, page, pageSize });
    }
    conditions.push(inArray(hosts.id, ids));
  }

  // Filter by tag name via hostTags join
  if (tag) {
    const [tagRow] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, tag));
    if (!tagRow) {
      return c.json({ data: [], total: 0, page, pageSize });
    }
    const taggedIds = await db
      .select({ hostId: hostTags.hostId })
      .from(hostTags)
      .where(eq(hostTags.tagId, tagRow.id));
    const ids = taggedIds.map((t) => t.hostId);
    if (ids.length === 0) {
      return c.json({ data: [], total: 0, page, pageSize });
    }
    conditions.push(inArray(hosts.id, ids));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(hosts)
    .where(where);
  const count = countResult[0]?.count ?? 0;

  const rows = await db
    .select()
    .from(hosts)
    .where(where)
    .orderBy(desc(hosts.lastSeen))
    .limit(pageSize)
    .offset(offset);

  return c.json({ data: rows, total: count, page, pageSize });
});

/** GET /api/hosts/:id — full detail with observations and enrichments */
hostsRouter.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');

  const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
  if (!host) return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);

  const observations = await db
    .select()
    .from(hostObservations)
    .where(eq(hostObservations.hostId, id))
    .orderBy(desc(hostObservations.observedAt))
    .limit(50);

  const enrichmentRows = await db
    .select()
    .from(enrichments)
    .where(eq(enrichments.hostId, id))
    .orderBy(desc(enrichments.fetchedAt));

  const hostTagRows = await db
    .select({ tag: tags })
    .from(hostTags)
    .innerJoin(tags, eq(hostTags.tagId, tags.id))
    .where(eq(hostTags.hostId, id));

  return c.json({
    data: {
      ...host,
      observations,
      enrichments: enrichmentRows,
      tags: hostTagRows.map((r) => r.tag),
    },
  });
});

/** PATCH /api/hosts/:id — update triage state, notes, snooze */
hostsRouter.patch('/:id', zValidator('json', PatchHostSchema), async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, id));
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);

  const updates: Partial<typeof hosts.$inferInsert> = {};
  if (body.triageState !== undefined) updates.triageState = body.triageState;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.snoozeUntil !== undefined) updates.snoozeUntil = body.snoozeUntil;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No fields to update' } }, 400);
  }

  await db.update(hosts).set(updates).where(eq(hosts.id, id));

  const [updated] = await db.select().from(hosts).where(eq(hosts.id, id));
  return c.json({ data: updated });
});

export { hostsRouter };
