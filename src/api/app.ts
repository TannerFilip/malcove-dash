import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler, devAccessShim } from './middleware';
import { health } from './routes/health';
import { queriesRouter } from './routes/queries';
import { hostsRouter } from './routes/hosts';
import { runsRouter } from './routes/runs';
import { enrichmentsRouter } from './routes/enrichments';
import { changesRouter } from './routes/changes';
import { pivotsRouter } from './routes/pivots';
import { validinRouter } from './routes/validin';
import { quotaRouter } from './routes/quota';

const api = new Hono<{ Bindings: Env }>()
  .route('/health', health)
  .route('/queries', queriesRouter)
  .route('/hosts', hostsRouter)
  .route('/runs', runsRouter)
  .route('/enrichments', enrichmentsRouter)
  .route('/changes', changesRouter)
  .route('/hosts', pivotsRouter)          // POST/GET /api/hosts/:id/pivots
  .route('/validin', validinRouter)       // GET /api/validin/ip/:ip/pdns etc.
  .route('/quota', quotaRouter);          // GET /api/quota

const app = new Hono<{ Bindings: Env }>()
  .use('*', logger())
  .use('*', devAccessShim)
  .use(
    '*',
    cors({
      origin: (_origin, c) => {
        return c.req.header('origin') ?? '*';
      },
      credentials: true,
    }),
  )
  .route('/api', api)
  .onError(errorHandler);

export { app };
