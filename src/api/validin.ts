import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas — permissive (.passthrough + .nullish) so format variations don't
// blow up. The UI renders raw records so extra fields are fine.
// ---------------------------------------------------------------------------

const ValidinPdnsRecordSchema = z.object({
  query: z.string().nullish(),
  answer: z.string().nullish(),
  type: z.string().nullish(),
  first_seen: z.number().nullish(),
  last_seen: z.number().nullish(),
  count: z.number().nullish(),
}).passthrough();

export const ValidinPdnsResponseSchema = z.object({
  records: z.array(ValidinPdnsRecordSchema).default([]),
}).passthrough();

export type ValidinPdnsRecord = z.infer<typeof ValidinPdnsRecordSchema>;
export type ValidinPdnsResponse = z.infer<typeof ValidinPdnsResponseSchema>;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ValidinClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.validin.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `BEARER ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Validin API error ${res.status}: ${body}`);
    }
    const raw: unknown = await res.json();
    return schema.parse(raw);
  }

  /** Passive DNS: what hostnames have resolved to this IP? */
  async pdnsForIp(ip: string): Promise<ValidinPdnsResponse> {
    return this.get(
      `/api/v1/intelligence/ip/${encodeURIComponent(ip)}/pdns`,
      ValidinPdnsResponseSchema,
    );
  }

  /** Passive DNS: what IPs has this domain resolved to? */
  async pdnsForDomain(domain: string): Promise<ValidinPdnsResponse> {
    return this.get(
      `/api/v1/intelligence/domain/${encodeURIComponent(domain)}/pdns`,
      ValidinPdnsResponseSchema,
    );
  }
}
