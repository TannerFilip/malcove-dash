/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare bindings injected at runtime via wrangler.toml.
 * Extend this as new bindings are added.
 */
interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  ENRICHMENT_QUEUE: Queue;

  // Secrets (set via `wrangler secret put`)
  SHODAN_API_KEY: string;
  VALIDIN_API_KEY: string;
  ENRICHMENT_INGEST_TOKEN: string;
}
