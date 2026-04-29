/**
 * Shared types for messages sent over the malcove-enrich Cloudflare Queue.
 * Imported by both the Pages Functions API (producer) and the enrichment Worker (consumer).
 */

/** Enrichment sources the pipeline knows how to handle. */
export type EnrichmentSource = 'rdns' | 'shodan_host';

/** All valid sources, for validation. */
export const ENRICHMENT_SOURCES: EnrichmentSource[] = ['rdns', 'shodan_host'];

/** Shape of every message on the malcove-enrich queue. */
export interface EnrichmentMessage {
  /** "${ip}:${port}" — primary key in the hosts table. */
  hostId: string;
  /** IPv4 or IPv6 string, e.g. "1.2.3.4". */
  ip: string;
  /** TCP port number. */
  port: number;
  /** Which enrichment jobs to run for this host. */
  sources: EnrichmentSource[];
}
