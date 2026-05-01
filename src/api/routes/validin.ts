import { Hono } from 'hono';
import { ValidinClient } from '../validin';

// ---------------------------------------------------------------------------
// Validin proxy — adds the API key server-side, forwards responses verbatim.
// ---------------------------------------------------------------------------

export const validinRouter = new Hono<{ Bindings: Env }>();

validinRouter.get('/ip/:ip/pdns', async (c) => {
  if (!c.env.VALIDIN_API_KEY) {
    return c.json({ error: { code: 'NOT_CONFIGURED', message: 'VALIDIN_API_KEY not set' } }, 503);
  }
  const client = new ValidinClient(c.env.VALIDIN_API_KEY);
  try {
    const data = await client.pdnsForIp(c.req.param('ip'));
    return c.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validin request failed';
    return c.json({ error: { code: 'VALIDIN_ERROR', message: msg } }, 502);
  }
});

validinRouter.get('/domain/:domain/pdns', async (c) => {
  if (!c.env.VALIDIN_API_KEY) {
    return c.json({ error: { code: 'NOT_CONFIGURED', message: 'VALIDIN_API_KEY not set' } }, 503);
  }
  const client = new ValidinClient(c.env.VALIDIN_API_KEY);
  try {
    const data = await client.pdnsForDomain(c.req.param('domain'));
    return c.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validin request failed';
    return c.json({ error: { code: 'VALIDIN_ERROR', message: msg } }, 502);
  }
});
