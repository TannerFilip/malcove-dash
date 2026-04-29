import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler, devAccessShim } from './middleware';
import { health } from './routes/health';

const app = new Hono<{ Bindings: Env }>()
  .use('*', logger())
  .use('*', devAccessShim)
  .use(
    '*',
    cors({
      origin: (_origin, c) => {
        // In dev, allow all. In production, Pages serves API and UI from the
        // same origin so CORS isn't required, but this keeps options open.
        return c.req.header('origin') ?? '*';
      },
      credentials: true,
    }),
  )
  // Sub-routers
  .route('/health', health)
  // Future routes mounted here (Phase 1+)

  // Global error handler
  .onError(errorHandler);

export { app };
