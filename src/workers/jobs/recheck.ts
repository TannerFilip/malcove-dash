/**
 * Nightly recheck job — re-fetches a host from Shodan and records a new
 * observation only when the banner hash has changed.
 *
 * Uses GET /shodan/host/:ip which does NOT consume query credits.
 */

import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { createDb } from '../../db/client';
import { hostObservations } from '../../db/schema';
import { ShodanClient } from '../../api/shodan';
import { bannerHash } from '../../api/diff';

type Db = ReturnType<typeof createDb>;

export interface RecheckResult {
  changed: boolean;
}

/**
 * Re-fetch a single host and write a 'recheck' observation if its banner changed.
 *
 * @returns { changed: true } when a new observation was written.
 */
export async function recheckHost(
  db: Db,
  env: Pick<Env, 'SHODAN_API_KEY' | 'KV'>,
  host: { id: string; ip: string; port: number },
): Promise<RecheckResult> {
  const shodan = new ShodanClient(env.SHODAN_API_KEY, env.KV);

  // getHost does not call incrementQuota — no credit consumed.
  let hostData: Record<string, unknown>;
  try {
    hostData = (await shodan.getHost(host.ip)) as unknown as Record<string, unknown>;
  } catch {
    // Transient error (rate limit, network blip) — skip silently.
    return { changed: false };
  }

  const newHash = await bannerHash(hostData);

  // Compare against the most recent stored observation (any source).
  const [latest] = await db
    .select({ bannerHash: hostObservations.bannerHash })
    .from(hostObservations)
    .where(eq(hostObservations.hostId, host.id))
    .orderBy(desc(hostObservations.observedAt))
    .limit(1);

  // If no prior observation, or hash is the same, nothing to record.
  if (latest !== undefined && latest.bannerHash === newHash) {
    return { changed: false };
  }

  // Something changed (or first observation for this host) — write a new record.
  await db.insert(hostObservations).values({
    id: nanoid(),
    hostId: host.id,
    runId: null,           // recheck observations aren't tied to a query run
    observedAt: Math.floor(Date.now() / 1000),
    banner: hostData,
    bannerHash: newHash,
    certFingerprint: null, // cert extraction happens in the run pipeline, not here
    source: 'recheck',
  });

  return { changed: true };
}
