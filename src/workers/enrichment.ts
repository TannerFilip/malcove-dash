/**
 * Enrichment Worker — Cloudflare Worker that:
 *
 *   1. Consumes messages from the `malcove-enrich` Queue and runs the requested
 *      enrichment jobs (rdns, shodan_host) for each host.
 *
 *   2. Runs a daily cron (configured in wrangler.worker.toml) that enqueues
 *      hosts which haven't been enriched in the last 7 days.
 *
 * Deploy separately from the Pages project:
 *   wrangler deploy --config src/workers/wrangler.worker.toml
 */

/// <reference path="../worker-env.d.ts" />

import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../db/client';
import { hosts, enrichments } from '../db/schema';
import { runRdns } from './jobs/rdns';
import { runShodanHost } from './jobs/shodan-host';
import type { EnrichmentMessage, EnrichmentSource } from '../shared/queue-types';
import { ENRICHMENT_SOURCES } from '../shared/queue-types';

// ---------------------------------------------------------------------------
// Per-host enrichment dispatcher
// ---------------------------------------------------------------------------

async function enrichHost(
  db: ReturnType<typeof createDb>,
  env: Env,
  msg: EnrichmentMessage,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const source of msg.sources) {
    let data: Record<string, unknown> | null = null;

    if (source === 'rdns') {
      const result = await runRdns(msg.ip);
      data = result as Record<string, unknown> | null;
    } else if (source === 'shodan_host') {
      data = await runShodanHost(msg.ip, env.SHODAN_API_KEY);
    }

    if (data === null) continue; // skip on error; message will be retried

    await db.insert(enrichments).values({
      id: nanoid(),
      hostId: msg.hostId,
      source,
      data,
      fetchedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Cron: enqueue stale hosts (no rdns enrichment in the last 7 days)
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_SECS = 7 * 24 * 60 * 60; // 7 days
const CRON_BATCH_LIMIT = 100; // how many hosts to enqueue per cron tick
const DEFAULT_SOURCES: EnrichmentSource[] = ['rdns', 'shodan_host'];

async function enqueueStaleHosts(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const cutoff = Math.floor(Date.now() / 1000) - STALE_THRESHOLD_SECS;

  // Find hosts with no 'rdns' enrichment newer than the cutoff
  const stale = await db
    .select({ id: hosts.id, ip: hosts.ip, port: hosts.port })
    .from(hosts)
    .where(
      sql`${hosts.id} NOT IN (
        SELECT DISTINCT host_id FROM enrichments
        WHERE source = 'rdns' AND fetched_at > ${cutoff}
      )`,
    )
    .limit(CRON_BATCH_LIMIT);

  if (stale.length === 0) return;

  await env.ENRICHMENT_QUEUE.sendBatch(
    stale.map((h) => ({
      body: {
        hostId: h.id,
        ip: h.ip,
        port: h.port,
        sources: DEFAULT_SOURCES,
      } satisfies EnrichmentMessage,
    })),
  );
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  /**
   * Queue consumer — processes one batch of enrichment messages.
   * Each message is ack'd individually; failures are retried by the queue.
   */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const db = createDb(env.DB);

    for (const message of batch.messages) {
      // Cast to our known shape — the queue only receives messages we send
      const body = message.body as EnrichmentMessage;
      // Validate sources — drop unknown values so bad messages don't crash the worker
      const validSources = body.sources.filter((s): s is EnrichmentSource =>
        (ENRICHMENT_SOURCES as string[]).includes(s),
      );
      if (validSources.length === 0) {
        message.ack();
        continue;
      }

      try {
        await enrichHost(db, env, { ...body, sources: validSources });
        message.ack();
      } catch {
        // retry() puts the message back on the queue (up to max_retries times)
        message.retry();
      }
    }
  },

  /**
   * Cron trigger — enqueues stale hosts for re-enrichment.
   * Fires at 02:00 UTC daily (configured in wrangler.worker.toml).
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await enqueueStaleHosts(env);
  },
} satisfies ExportedHandler<Env, EnrichmentMessage>;
