import { Hono } from 'hono';
import { createDb } from '../../db/client';

const health = new Hono<{ Bindings: Env }>();

/**
 * GET /api/health
 * Returns { ok: true, ts: <unix seconds> } after confirming D1 is reachable.
 */
health.get('/', async (c) => {
  const db = createDb(c.env.DB);

  // Lightweight D1 liveness check — just read the SQLite version
  const result = await c.env.DB.prepare('SELECT unixepoch() AS ts').first<{ ts: number }>();

  if (!result) {
    return c.json({ error: { code: 'DB_ERROR', message: 'D1 did not return a row' } }, 503);
  }

  return c.json({ ok: true, ts: result.ts });
});

export { health };
