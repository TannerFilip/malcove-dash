import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../../db/client';
import { queryRuns } from '../../db/schema';

const runsRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/runs/:runId — fetch a run's summary (counts, status).
 * Used by the host list pill summary without requiring queryId.
 */
runsRouter.get('/:runId', async (c) => {
  const db = createDb(c.env.DB);
  const runId = c.req.param('runId');

  const [run] = await db.select().from(queryRuns).where(eq(queryRuns.id, runId));
  if (!run) return c.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404);

  return c.json({ data: run });
});

export { runsRouter };
