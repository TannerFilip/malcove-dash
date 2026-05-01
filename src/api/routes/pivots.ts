import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../../db/client';
import { hosts, pivots, hostObservations } from '../../db/schema';
import { ShodanClient, type ShodanSearchMatch } from '../shodan';
import { bannerHash } from '../diff';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PIVOT_TYPES = ['cert_serial', 'jarm', 'favicon_hash', 'ja4x', 'asn_port', 'cert_subject', 'manual'] as const;
type PivotType = typeof PIVOT_TYPES[number];

const ExecutePivotSchema = z.object({
  pivotType: z.enum(PIVOT_TYPES),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract cert/jarm/ASN fields from a search match (same logic as queries.ts). */
function extractFields(match: ShodanSearchMatch) {
  const asnRaw = match.asn;
  const asn = asnRaw ? parseInt(asnRaw.replace(/^AS/i, ''), 10) : null;
  const ssl = match.ssl;
  const cert = ssl?.cert;
  return {
    asn: Number.isNaN(asn) ? null : asn,
    country: match.country_code ?? null,
    org: match.org ?? null,
    hostname: match.hostnames?.[0] ?? null,
    certSerial: cert?.serial != null ? String(cert.serial) : null,
    certSubject: cert?.subject ? JSON.stringify(cert.subject) : null,
    certIssuer: cert?.issuer ? JSON.stringify(cert.issuer) : null,
    jarm: ssl?.jarm ?? null,
    certFingerprint: cert?.fingerprint?.sha256 ?? null,
  };
}

/** Build the Shodan query for a given pivot type + source host row. */
function buildShodanQuery(
  pivotType: PivotType,
  host: Record<string, unknown>,
): { query: string; pivotValue: string } | null {
  switch (pivotType) {
    case 'cert_serial': {
      const v = host['certSerial'] as string | null;
      return v ? { query: `ssl.cert.serial:${v}`, pivotValue: v } : null;
    }
    case 'jarm': {
      const v = host['jarm'] as string | null;
      return v ? { query: `ssl.jarm:${v}`, pivotValue: v } : null;
    }
    case 'favicon_hash': {
      const v = host['faviconHash'] as string | null;
      return v ? { query: `http.favicon.hash:${v}`, pivotValue: v } : null;
    }
    case 'ja4x': {
      const v = host['ja4x'] as string | null;
      return v ? { query: `ssl.ja4x:${v}`, pivotValue: v } : null;
    }
    case 'asn_port': {
      const asn = host['asn'] as number | null;
      const port = host['port'] as number | null;
      if (!asn || !port) return null;
      const v = `AS${asn}:${port}`;
      return { query: `asn:AS${asn} port:${port}`, pivotValue: v };
    }
    case 'cert_subject': {
      const subjectStr = host['certSubject'] as string | null;
      if (!subjectStr) return null;
      try {
        const parsed = JSON.parse(subjectStr) as Record<string, unknown>;
        const cn = parsed['CN'] as string | undefined;
        if (!cn) return null;
        return { query: `ssl.cert.subject.cn:"${cn}"`, pivotValue: cn };
      } catch {
        return null;
      }
    }
    case 'manual':
      return null;
  }
}

/** Upsert a host from a Shodan search match and insert an observation row. */
async function upsertHostFromMatch(
  db: ReturnType<typeof createDb>,
  match: ShodanSearchMatch,
  now: number,
): Promise<string> {
  const ip = match.ip_str;
  const port = match.port;
  const hostId = `${ip}:${port}`;
  const fields = extractFields(match);

  await db
    .insert(hosts)
    .values({
      id: hostId,
      ip,
      port,
      asn: fields.asn,
      country: fields.country,
      org: fields.org,
      hostname: fields.hostname,
      certSerial: fields.certSerial,
      certIssuer: fields.certIssuer,
      certSubject: fields.certSubject,
      jarm: fields.jarm,
      faviconHash: null,
      ja4x: null,
      triageState: 'new',
      snoozeUntil: null,
      notes: null,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      target: hosts.id,
      set: {
        asn: fields.asn,
        country: fields.country,
        org: fields.org,
        hostname: fields.hostname,
        certSerial: fields.certSerial,
        certIssuer: fields.certIssuer,
        certSubject: fields.certSubject,
        jarm: fields.jarm,
        lastSeen: now,
      },
    });

  const hash = await bannerHash(match);
  await db.insert(hostObservations).values({
    id: nanoid(),
    hostId,
    runId: null,
    observedAt: now,
    banner: match as unknown as Record<string, unknown>,
    bannerHash: hash,
    certFingerprint: fields.certFingerprint,
    source: 'shodan',
  });

  return hostId;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pivotsRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/hosts/:id/pivots
 * Execute a pivot: run a Shodan query derived from one of the host's fingerprint
 * fields, upsert the results, record pivot edges, return found hosts.
 */
pivotsRouter.post('/:id/pivots', zValidator('json', ExecutePivotSchema), async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.req.param('id');
  const { pivotType } = c.req.valid('json');

  // Fetch source host
  const [host] = await db.select().from(hosts).where(eq(hosts.id, hostId)).limit(1);
  if (!host) return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);

  const built = buildShodanQuery(pivotType, host as unknown as Record<string, unknown>);
  if (!built) {
    return c.json({
      error: {
        code: 'NO_PIVOT_VALUE',
        message: `Host does not have a value for pivot type "${pivotType}"`,
      },
    }, 422);
  }

  const { query, pivotValue } = built;
  const shodan = new ShodanClient(c.env.SHODAN_API_KEY, c.env.KV);

  // Run Shodan search (page 1 only — pivots cap at 100 results)
  const result = await shodan.searchHosts(query, { page: 1 });
  const now = Math.floor(Date.now() / 1000);
  const foundHostIds: string[] = [];

  // Chunk to stay within D1's 100-param limit
  const CHUNK = 25;
  for (let i = 0; i < result.matches.length; i += CHUNK) {
    const chunk = result.matches.slice(i, i + CHUNK);
    for (const match of chunk) {
      const fid = await upsertHostFromMatch(db, match, now);
      if (fid !== hostId) foundHostIds.push(fid);
    }
  }

  // Create pivot records (skip self and skip already-existing edges)
  const newPivotIds: string[] = [];
  for (const toId of foundHostIds) {
    const [existing] = await db
      .select({ id: pivots.id })
      .from(pivots)
      .where(and(
        eq(pivots.fromHostId, hostId),
        eq(pivots.toHostId, toId),
        eq(pivots.pivotType, pivotType),
      ))
      .limit(1);

    if (!existing) {
      const pid = nanoid();
      await db.insert(pivots).values({
        id: pid,
        fromHostId: hostId,
        toHostId: toId,
        pivotType,
        pivotValue,
      });
      newPivotIds.push(pid);
    }
  }

  // Return the found host rows
  const foundHosts = foundHostIds.length > 0
    ? await db.select().from(hosts).where(inArray(hosts.id, foundHostIds))
    : [];

  return c.json({
    data: {
      pivotType,
      pivotValue,
      shodanTotal: result.total,
      found: foundHosts.length,
      newPivots: newPivotIds.length,
      hosts: foundHosts,
    },
  });
});

/**
 * GET /api/hosts/:id/pivots
 * List all pivot edges for a host — both outgoing (this → other) and incoming
 * (other → this), with basic info about the related host.
 */
pivotsRouter.get('/:id/pivots', async (c) => {
  const db = createDb(c.env.DB);
  const hostId = c.req.param('id');

  const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, hostId)).limit(1);
  if (!host) return c.json({ error: { code: 'NOT_FOUND', message: 'Host not found' } }, 404);

  // Fetch pivots in both directions
  const outgoing = await db
    .select()
    .from(pivots)
    .where(eq(pivots.fromHostId, hostId));

  const incoming = await db
    .select()
    .from(pivots)
    .where(eq(pivots.toHostId, hostId));

  // Collect related host IDs
  const relatedIds = [
    ...new Set([
      ...outgoing.map((p) => p.toHostId),
      ...incoming.map((p) => p.fromHostId),
    ]),
  ].filter((id) => id !== hostId);

  const relatedHosts = relatedIds.length > 0
    ? await db
        .select({
          id: hosts.id,
          ip: hosts.ip,
          port: hosts.port,
          hostname: hosts.hostname,
          org: hosts.org,
          asn: hosts.asn,
          triageState: hosts.triageState,
          jarm: hosts.jarm,
          certSerial: hosts.certSerial,
        })
        .from(hosts)
        .where(inArray(hosts.id, relatedIds))
    : [];

  const hostMap = new Map(relatedHosts.map((h) => [h.id, h]));

  const toEntry = (p: typeof outgoing[number], direction: 'out' | 'in') => ({
    id: p.id,
    pivotType: p.pivotType,
    pivotValue: p.pivotValue,
    createdAt: p.createdAt,
    direction,
    relatedHost: hostMap.get(direction === 'out' ? p.toHostId : p.fromHostId) ?? null,
  });

  const data = [
    ...outgoing.map((p) => toEntry(p, 'out')),
    ...incoming.map((p) => toEntry(p, 'in')),
  ].sort((a, b) => b.createdAt - a.createdAt);

  return c.json({ data });
});
