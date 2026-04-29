import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for Shodan API responses
// ---------------------------------------------------------------------------

const ShodanServiceSchema = z.object({
  port: z.number(),
  transport: z.string().optional(),
  product: z.string().optional(),
  version: z.string().optional(),
  data: z.string().optional(),
  // HTTP module fields
  http: z.object({
    title: z.string().optional(),
    server: z.string().optional(),
    favicon: z.object({ hash: z.number().optional() }).optional(),
  }).optional(),
  // SSL/TLS fields
  ssl: z.object({
    cert: z.object({
      serial: z.number().optional(),
      subject: z.record(z.string(), z.unknown()).optional(),
      issuer: z.record(z.string(), z.unknown()).optional(),
      fingerprint: z.object({ sha256: z.string().optional() }).optional(),
    }).optional(),
    jarm: z.string().optional(),
  }).optional(),
}).passthrough(); // Keep all extra fields in the raw banner

const ShodanHostSchema = z.object({
  ip_str: z.string(),
  port: z.number(),
  asn: z.string().optional(),   // "AS12345"
  org: z.string().optional(),
  country_code: z.string().optional(),
  hostnames: z.array(z.string()).optional(),
  data: z.array(ShodanServiceSchema).optional(),
  // Top-level cert fields (some endpoints hoist these)
  ssl: z.object({
    cert: z.object({
      serial: z.number().optional(),
      subject: z.record(z.string(), z.unknown()).optional(),
      issuer: z.record(z.string(), z.unknown()).optional(),
      fingerprint: z.object({ sha256: z.string().optional() }).optional(),
    }).optional(),
    jarm: z.string().optional(),
  }).optional(),
}).passthrough();

export type ShodanHost = z.infer<typeof ShodanHostSchema>;

const ShodanSearchResultSchema = z.object({
  matches: z.array(ShodanHostSchema),
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
