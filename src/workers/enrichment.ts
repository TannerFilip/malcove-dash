/**
 * Enrichment Worker — Cloudflare Worker that:
 *
 *   1. Consumes messages from the `malcove-enrich` Queue and runs the requested
 *      enrichment jobs (rdns, shodan_host) for each host.
 *
 *   2. Cron at 02:00 UTC — enqueues hosts that haven't been enriched in 7+ days.
 *
 *   3. Cron at 04:00 UTC — re-fetches Shodan data for hosts in monitoring /
 *      notable / reviewing states and records changes as new observations.
 *
 * Deploy separately from the Pages project:
 *   wrangler deploy --config src/workers/wrangler.worker.toml
 */

/// <reference path="../worker-env.d.ts" />

import { eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../db/client';
import { hosts, enrichments } from '../db/schema';
import { runRdns } from './jobs/rdns';
import { runShodanHost } from './jobs/shodan-host';
import { recheckHost } from './jobs/recheck';
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
// Cron A — 02:00 UTC: enqueue stale hosts for enrichment
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_SECS = 7 * 24 * 60 * 60; // 7 days
const ENRICH_BATCH_LIMIT = 100;
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
    .limit(ENRICH_BATCH_LIMIT);

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
// Cron B — 04:00 UTC: recheck monitored / notable / reviewing hosts
// ---------------------------------------------------------------------------

/** Triage states that warrant a nightly Shodan banner re-fetch. */
const RECHECK_STATES = ['monitoring', 'notable', 'reviewing'] as const;
/** Max hosts to recheck per cron tick (keeps execution within 30s CPU budget). */
const RECHECK_BATCH_LIMIT = 50;

async function recheckMonitoredHosts(env: Env): Promise<void> {
  const db = createDb(env.DB);

  const monitored = await db
    .select({ id: hosts.id, ip: hosts.ip, port: hosts.port })
    .from(hosts)
    .where(inArray(hosts.triageState, [...RECHECK_STATES]))
    .limit(RECHECK_BATCH_LIMIT);

  if (monitored.length === 0) return;

  // Sequential to keep memory/CPU usage predictable
  for (const host of monitored) {
    await recheckHost(db, env, host);
  }
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
      const body = message.body as EnrichmentMessage;
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
        message.retry();
      }
    }
  },

  /**
   * fetch handler — required by wrangler dev so /__scheduled works for local testing.
   * This Worker is not reachable via HTTP in production (no route binding).
   */
  fetch(): Response {
    return new Response('malcove-enrich-worker', { status: 200 });
  },

  /**
   * Cron handler — dispatches to the correct job based on the schedule expression.
   *   "0 2 * * *"  → enqueue stale hosts for enrichment
   *   "0 4 * * *"  → recheck monitored/notable/reviewing hosts
   */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    switch (controller.cron) {
      case '0 2 * * *':
        await enqueueStaleHosts(env);
        break;
      case '0 4 * * *':
        await recheckMonitoredHosts(env);
        break;
      default:
        // Unknown cron expression — run both to be safe
        await enqueueStaleHosts(env);
        await recheckMonitoredHosts(env);
    }
  },
} satisfies ExportedHandler<Env, EnrichmentMessage>;
