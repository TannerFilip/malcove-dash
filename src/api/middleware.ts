import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Error handler — converts all thrown errors into the standard envelope:
 *   { error: { code, message, details? } }
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: `HTTP_${err.status}`,
          message: err.message,
        },
      },
      err.status,
    );
  }

  console.error('[api error]', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
    500,
  );
}

/**
 * Dev-mode Access shim.
 * In production, Cloudflare Access sets Cf-Access-Authenticated-User-Email
 * before the request reaches the Worker. In local dev (wrangler pages dev)
 * Access is not in the path, so we inject a synthetic header.
 *
 * Only activated when CF_PAGES_LOCAL is truthy (set by Pages dev server).
 */
export async function devAccessShim(c: Context, next: Next) {
  const isLocal =
    (c.env as Record<string, unknown>)['CF_PAGES_LOCAL'] === 'true' ||
    c.req.header('x-dev-mode') === '1';

  if (isLocal && !c.req.header('cf-access-authenticated-user-email')) {
    // Mutating raw headers isn't possible after request creation, so we store
    // the dev user in a context variable instead.
    c.set('userEmail', 'dev@localhost');
  } else {
    const email = c.req.header('cf-access-authenticated-user-email');
    if (email) c.set('userEmail', email);
  }

  await next();
}
