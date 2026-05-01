import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for Shodan API responses
// ---------------------------------------------------------------------------

// Shared SSL sub-schema used in both search matches and host detail
// Use .nullish() throughout — Shodan sends null for missing fields, not undefined
const ShodanSslSchema = z.object({
  cert: z.object({
    serial: z.number().nullish(),
    subject: z.record(z.string(), z.unknown()).nullish(),
    issuer: z.record(z.string(), z.unknown()).nullish(),
    fingerprint: z.object({ sha256: z.string().nullish() }).nullish(),
  }).nullish(),
  jarm: z.string().nullish(),
}).nullish();

// Shared HTTP sub-schema
const ShodanHttpSchema = z.object({
  title: z.string().nullish(),
  server: z.string().nullish(),
  favicon: z.object({ hash: z.number().nullish() }).nullish(),
}).nullish();

// ---------------------------------------------------------------------------
// Search match schema — each entry in /shodan/host/search "matches" is a
// single service observation. "data" here is the raw banner string.
// ---------------------------------------------------------------------------

const ShodanSearchMatchSchema = z.object({
  ip_str: z.string(),
  port: z.number(),
  asn: z.string().nullish(),          // "AS12345" or null
  org: z.string().nullish(),
  country_code: z.string().nullish(),
  hostnames: z.array(z.string()).nullish(),
  transport: z.string().nullish(),
  product: z.string().nullish(),
  version: z.string().nullish(),
  data: z.string().nullish(),          // raw banner string
  http: ShodanHttpSchema,
  ssl: ShodanSslSchema,
}).passthrough();

export type ShodanSearchMatch = z.infer<typeof ShodanSearchMatchSchema>;

// ---------------------------------------------------------------------------
// Host detail schema — returned by /shodan/host/:ip. "data" is an array of
// per-service observations, each with their own banner string and SSL fields.
// ---------------------------------------------------------------------------

const ShodanServiceSchema = z.object({
  port: z.number(),
  transport: z.string().nullish(),
  product: z.string().nullish(),
  version: z.string().nullish(),
  data: z.string().nullish(),          // raw banner string for this service
  http: ShodanHttpSchema,
  ssl: ShodanSslSchema,
}).passthrough();

const ShodanHostSchema = z.object({
  ip_str: z.string(),
  port: z.number(),
  asn: z.string().nullish(),
  org: z.string().nullish(),
  country_code: z.string().nullish(),
  hostnames: z.array(z.string()).nullish(),
  data: z.array(ShodanServiceSchema).nullish(), // array of services
  ssl: ShodanSslSchema,
}).passthrough();

export type ShodanHost = z.infer<typeof ShodanHostSchema>;

const ShodanSearchResultSchema = z.object({
  matches: z.array(ShodanSearchMatchSchema),
  total: z.number(),
});

export type ShodanSearchResult = z.infer<typeof ShodanSearchResultSchema>;

// ---------------------------------------------------------------------------
// KV quota key
// ---------------------------------------------------------------------------

const kvQuotaKey = (month: string) => `shodan:quota:${month}`;

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ShodanClient {
  private readonly apiKey: string;
  private readonly kv: KVNamespace;
  private readonly baseUrl = 'https://api.shodan.io';

  constructor(apiKey: string, kv: KVNamespace) {
    this.apiKey = apiKey;
    this.kv = kv;
  }

  /** Increment the monthly query counter in KV and return the new value. */
  private async incrementQuota(): Promise<number> {
    const key = kvQuotaKey(currentMonth());
    const current = await this.kv.get(key);
    const next = (current ? parseInt(current, 10) : 0) + 1;
    // TTL: 35 days — safely covers the full month plus rollover
    await this.kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 35 });
    return next;
  }

  /** Read current month's query count without incrementing. */
  async getQuotaUsed(): Promise<number> {
    const key = kvQuotaKey(currentMonth());
    const val = await this.kv.get(key);
    return val ? parseInt(val, 10) : 0;
  }

  /**
   * Fetch Shodan account info — plan, remaining credits, etc.
   * Does NOT consume query credits.
   */
  async getApiInfo(): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/api-info`);
    url.searchParams.set('key', this.apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shodan API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  /**
   * Search Shodan with a query string, paginated.
   * Each call = 1 query credit. Increments KV counter.
   */
  async searchHosts(
    query: string,
    options: { page?: number } = {},
  ): Promise<ShodanSearchResult> {
    const page = options.page ?? 1;
    const url = new URL(`${this.baseUrl}/shodan/host/search`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('page', String(page));

    await this.incrementQuota();

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shodan API error ${res.status}: ${body}`);
    }

    const raw: unknown = await res.json();
    return ShodanSearchResultSchema.parse(raw);
  }

  /**
   * Fetch a single host by IP. No query credit consumed.
   */
  async getHost(ip: string): Promise<ShodanHost> {
    const url = new URL(`${this.baseUrl}/shodan/host/${ip}`);
    url.searchParams.set('key', this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shodan API error ${res.status}: ${body}`);
    }

    const raw: unknown = await res.json();
    return ShodanHostSchema.parse(raw);
  }
}
