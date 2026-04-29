/**
 * Cloudflare Pages Functions catch-all route for /api/*
 *
 * Pages Functions passes an EventContext, not a bare Request — so we must use
 * Hono's handle() adapter which unwraps the context before dispatching.
 */
import { handle } from 'hono/cloudflare-pages';
import { app } from '../../src/api/app';

export const onRequest = handle(app);
