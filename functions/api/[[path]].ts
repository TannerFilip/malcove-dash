/**
 * Cloudflare Pages Functions catch-all route for /api/*
 *
 * Hono is mounted here and handles all routing internally.
 * The Pages Functions runtime passes an EventContext; we extract the
 * underlying Request and Env and hand off to Hono's fetch handler.
 */
import { app } from '../../src/api/app';

export const onRequest = app.fetch;
