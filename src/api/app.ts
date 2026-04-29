import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler, devAccessShim } from './middleware';
import { health } from './routes/health';
import { queriesRouter } from './routes/queries';
import { hostsRouter } from './routes/hosts';

const api = new Hono<{ Bindings: Env }>()
  .route('/health', health)
  .route('/queries', queriesRouter)
  .route('/hosts', hostsRouter);

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
