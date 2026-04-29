import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  queries,
  queryRuns,
  hosts,
  hostObservations,
  hostQueryMatches,
  pivots,
  tags,
  hostTags,
  enrichments,
} from '../db/schema';

// Select types (rows returned from DB)
export type Query = InferSelectModel<typeof queries>;
export type QueryRun = InferSelectModel<typeof queryRuns>;
export type Host = InferSelectModel<typeof hosts>;
export type HostObservation = InferSelectModel<typeof hostObservations>;
export type HostQueryMatch = InferSelectModel<typeof hostQueryMatches>;
export type Pivot = InferSelectModel<typeof pivots>;
export type Tag = InferSelectModel<typeof tags>;
export type HostTag = InferSelectModel<typeof hostTags>;
export type Enrichment = InferSelectModel<typeof enrichments>;

// Insert types
export type InsertQuery = InferInsertModel<typeof queries>;
export type InsertQueryRun = InferInsertModel<typeof queryRuns>;
export type InsertHost = InferInsertModel<typeof hosts>;
export type InsertHostObservation = InferInsertModel<typeof hostObservations>;
export type InsertHostQueryMatch = InferInsertModel<typeof hostQueryMatches>;
export type InsertPivot = InferInsertModel<typeof pivots>;
export type InsertTag = InferInsertModel<typeof tags>;
export type InsertEnrichment = InferInsertModel<typeof enrichments>;

// Triage state enum
export const TRIAGE_STATES = [
  'new',
  'reviewing',
  'notable',
  'dismissed',
  'false_positive',
  'monitoring',
  'needs_followup',
] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

// Pivot type enum
export const PIVOT_TYPES = [
  'cert_serial',
  'jarm',
  'favicon_hash',
  'ja4x',
  'asn_port',
  'cert_subject',
  'manual',
] as const;
export type PivotType = (typeof PIVOT_TYPES)[number];

// Query source enum
export const QUERY_SOURCES = ['shodan', 'validin'] as const;
export type QuerySource = (typeof QUERY_SOURCES)[number];

// Enrichment source type (open-ended, not an enum)
export type EnrichmentSource =
  | 'rdns'
  | 'asn_history'
  | 'jarm'
  | 'ja4x'
  | 'favicon'
  | 'screenshot'
  | 'validin'
  | 'shodan_host'
  | string;

// Observation source enum
export const OBSERVATION_SOURCES = ['shodan', 'validin', 'recheck', 'external'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

// Standard API error envelope
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
