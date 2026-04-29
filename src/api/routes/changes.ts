import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

/**
 * A host where the most recent observation's banner hash differs from the
 * immediately preceding observation.
 */
export interface ChangeEntry {
  id: string;            // "${ip}:${port}"
  ip: string;
  port: number;
  triageState: string;
  org: string | null;
  country: string | null;
  asn: number | null;
  hostname: string | null;
  firstSeen: number;
  lastSeen: number;
  /** Unix seconds when the change was detected. */
  changedAt: number;
  /** Source of the observation that introduced the change. */
  changeSource: string;
  oldHash: string;
  newHash: string;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/** SQL to find hosts whose latest banner hash differs from the prior one. */
function changesSql(since: number, limit: number, offset: number): string {
  return `
    SELECT
      h.id,
      h.ip,
      h.port,
      h.triage_state  AS triageState,
      h.org,
      h.country,
      h.asn,
      h.hostname,
      h.first_seen    AS firstSeen,
      h.last_seen     AS lastSeen,
      o1.observed_at  AS changedAt,
      o1.source       AS changeSource,
      o2.banner_hash  AS oldHash,
      o1.banner_hash  AS newHash
    FROM hosts h
    INNER JOIN host_observations o1
      ON o1.host_id = h.id
      AND o1.id = (
        SELECT id FROM host_observations
        WHERE host_id = h.id
        ORDER BY observed_at DESC
        LIMIT 1
      )
    INNER JOIN host_observations o2
      ON o2.host_id = h.id
      AND o2.id = (
        SELECT id FROM host_observations
        WHERE host_id = h.id
        ORDER BY observed_at DESC
        LIMIT 1 OFFSET 1
      )
    WHERE o1.banner_hash != o2.banner_hash
      AND o1.observed_at > ?
    ORDER BY o1.observed_at DESC
    LIMIT ? OFFSET ?
  `;
}

function changeCountSql(since: number): string {
  return `
    SELECT COUNT(*) AS count
    FROM hosts h
    INNER JOIN host_observations o1
      ON o1.host_id = h.id
      AND o1.id = (
        SELECT id FROM host_observations
        WHERE host_id = h.id
        ORDER BY observed_at DESC
        LIMIT 1
      )
    INNER JOIN host_observations o2
      ON o2.host_id = h.id
      AND o2.id = (
        SELECT id FROM host_observations
        WHERE host_id = h.id
        ORDER BY observed_at DESC
        LIMIT 1 OFFSET 1
      )
    WHERE o1.banner_hash != o2.banner_hash
      AND o1.observed_at > ?
  `;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ChangesQuerySchema = z.object({
  /** How many days back to look. */
  days: z.coerce.number().int().min(1).max(90).default(7),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const changesRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/changes — hosts whose most recent banner hash differs from the previous one.
 * Covers changes from both query runs (source='shodan') and nightly rechecks (source='recheck').
 */
changesRouter.get('/', zValidator('query', ChangesQuerySchema), async (c) => {
  const { days, page, pageSize } = c.req.valid('query');
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const offset = (page - 1) * pageSize;

  const [countRow, dataRows] = await Promise.all([
    c.env.DB.prepare(changeCountSql(since)).bind(since).first<{ count: number }>(),
    c.env.DB.prepare(changesSql(since, pageSize, offset)).bind(since, pageSize, offset).all<ChangeEntry>(),
  ]);

  const total = countRow?.count ?? 0;
  const data: ChangeEntry[] = dataRows.results ?? [];

  return c.json({ data, total, page, pageSize, days });
});

export { changesRouter };
