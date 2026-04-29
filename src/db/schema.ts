import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const queries = sqliteTable('queries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  queryString: text('query_string').notNull(),
  source: text('source', { enum: ['shodan', 'validin'] }).notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  schedule: text('schedule'),                            // cron expr or null
  lastRunAt: integer('last_run_at'),                     // unix seconds
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const queryRuns = sqliteTable('query_runs', {
  id: text('id').primaryKey(),
  queryId: text('query_id').notNull().references(() => queries.id, { onDelete: 'cascade' }),
  runAt: integer('run_at').notNull(),
  totalCount: integer('total_count'),
  newCount: integer('new_count'),
  changedCount: integer('changed_count'),
  rawResponseKey: text('raw_response_key'),              // R2 key
  errorMessage: text('error_message'),
}, (t) => [
  index('idx_runs_query').on(t.queryId, t.runAt),
]);

export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),                           // `${ip}:${port}`
  ip: text('ip').notNull(),
  port: integer('port').notNull(),
  asn: integer('asn'),
  country: text('country'),
  org: text('org'),
  hostname: text('hostname'),
  certSerial: text('cert_serial'),
  certIssuer: text('cert_issuer'),
  certSubject: text('cert_subject'),
  jarm: text('jarm'),
  faviconHash: text('favicon_hash'),
  ja4x: text('ja4x'),
  triageState: text('triage_state', {
    enum: ['new', 'reviewing', 'notable', 'dismissed', 'false_positive', 'monitoring', 'needs_followup'],
  }).notNull().default('new'),
  snoozeUntil: integer('snooze_until'),
  notes: text('notes'),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
}, (t) => [
  index('idx_hosts_triage').on(t.triageState, t.lastSeen),
  index('idx_hosts_asn').on(t.asn),
  index('idx_hosts_cert').on(t.certSerial),
  index('idx_hosts_jarm').on(t.jarm),
  index('idx_hosts_favicon').on(t.faviconHash),
  index('idx_hosts_snooze').on(t.snoozeUntil),
]);

export const hostObservations = sqliteTable('host_observations', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  runId: text('run_id').references(() => queryRuns.id, { onDelete: 'set null' }),
  observedAt: integer('observed_at').notNull(),
  banner: text('banner', { mode: 'json' }).notNull(),    // raw provider blob
  bannerHash: text('banner_hash').notNull(),             // sha256 hex of canonicalized banner
  certFingerprint: text('cert_fingerprint'),
  source: text('source', { enum: ['shodan', 'validin', 'recheck', 'external'] }).notNull(),
}, (t) => [
  index('idx_obs_host_time').on(t.hostId, t.observedAt),
  index('idx_obs_hash').on(t.bannerHash),
]);

export const hostQueryMatches = sqliteTable('host_query_matches', {
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => queryRuns.id, { onDelete: 'cascade' }),
  isNew: integer('is_new', { mode: 'boolean' }).notNull(),
  isChanged: integer('is_changed', { mode: 'boolean' }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.hostId, t.runId] }),
  index('idx_matches_run').on(t.runId),
]);

export const pivots = sqliteTable('pivots', {
  id: text('id').primaryKey(),
  fromHostId: text('from_host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  toHostId: text('to_host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  pivotType: text('pivot_type', {
    enum: ['cert_serial', 'jarm', 'favicon_hash', 'ja4x', 'asn_port', 'cert_subject', 'manual'],
  }).notNull(),
  pivotValue: text('pivot_value'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
  index('idx_pivots_from').on(t.fromHostId),
  index('idx_pivots_to').on(t.toHostId),
]);

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const hostTags = sqliteTable('host_tags', {
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.hostId, t.tagId] }),
]);

export const enrichments = sqliteTable('enrichments', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),                      // 'rdns' | 'asn_history' | 'jarm' | 'ja4x' | 'favicon' | 'screenshot' | 'validin' | etc.
  data: text('data', { mode: 'json' }).notNull(),
  fetchedAt: integer('fetched_at').notNull(),
}, (t) => [
  index('idx_enrich_host_source').on(t.hostId, t.source),
]);
