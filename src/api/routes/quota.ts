import { Hono } from 'hono';
import { ShodanClient } from '../shodan';

export const quotaRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/quota
 * Returns our KV-tracked monthly query count and live Shodan account info
 * (plan, query_credits remaining, scan_credits remaining).
 * Shodan /api-info does not consume credits.
 */
quotaRouter.get('/', async (c) => {
  const shodan = new ShodanClient(c.env.SHODAN_API_KEY, c.env.KV);

  const [queriesUsed, apiInfo] = await Promise.allSettled([
    shodan.getQuotaUsed(),
    shodan.getApiInfo(),
  ]);

  return c.json({
    data: {
      month: new Date().toISOString().slice(0, 7), // "YYYY-MM"
      queriesUsed: queriesUsed.status === 'fulfilled' ? queriesUsed.value : 0,
      shodan: apiInfo.status === 'fulfilled' ? apiInfo.value : null,
    },
  });
});
