import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useRef, useCallback } from 'react';
import { useHostDetail, usePatchHost } from '../hooks/useHosts';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useEnqueueEnrichment } from '../hooks/useEnrichments';
import {
  useHostPivots,
  useExecutePivot,
  useValidinPdns,
  PIVOT_TYPES,
  type PivotType,
  type PivotEntry,
} from '../hooks/usePivots';
import { TriageBadge } from '../components/TriageBadge';
import { JsonViewer } from '../components/JsonViewer';
import { TRIAGE_STATES, type TriageState, type HostObservation, type Host } from '../../shared/types';
import { diffBanners } from '../../shared/diff';

export const Route = createFileRoute('/hosts/$id')({
  component: HostDetailPage,
});

const TRIAGE_KEY_LABELS: Record<string, string> = {
  '1': 'new', '2': 'reviewing', '3': 'notable',
  '4': 'dismissed', '5': 'false_positive', '6': 'monitoring', '7': 'needs_followup',
};

type Tab = 'banner' | 'changes' | 'enrichments' | 'pivots';

function HostDetailPage() {
  const { id } = Route.useParams();
  const { data: host, isLoading, error } = useHostDetail(id);
  const patch = usePatchHost();
  const enrich = useEnqueueEnrichment(id);
  const { data: pivotEntries = [], isLoading: pivotsLoading } = useHostPivots(id);
  const executePivot = useExecutePivot(id);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>('banner');
  // Validin pDNS — only fetched once the user opens the pivots tab
  const [pdnsEnabled, setPdnsEnabled] = useState(false);
  const { data: pdnsRecords = [], isLoading: pdnsLoading } = useValidinPdns(
    host?.ip ?? '',
    pdnsEnabled && !!host?.ip,
  );

  const handleTriage = useCallback(
    (state: TriageState) => {
      patch.mutate({ id, triageState: state });
    },
    [id, patch],
  );

  useKeyboardNav({
    onTriage: handleTriage,
    onNotes: () => notesRef.current?.focus(),
  });

  if (isLoading) return <p className="text-xs text-zinc-500">Loading…</p>;
  if (error) return <p className="text-xs text-rose-400">{(error as Error).message}</p>;
  if (!host) return null;

  const latestObs: HostObservation | undefined = host.observations[0];
  const prevObs: HostObservation | undefined = host.observations[1];
  const hasChanges = latestObs !== undefined && prevObs !== undefined;

  // Compute diff lazily (only when Changes tab is active)
  const diffs = hasChanges
    ? diffBanners(
        prevObs.banner as Record<string, unknown>,
        latestObs.banner as Record<string, unknown>,
      )
    : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
              ← hosts
            </Link>
          </div>
          <h1 className="font-mono text-base text-zinc-100">
            {host.ip}:{host.port}
          </h1>
          {host.hostname && <p className="text-xs text-zinc-500">{host.hostname}</p>}
        </div>
        <TriageBadge state={host.triageState} />
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 rounded border border-zinc-800 bg-zinc-900 p-3 text-xs md:grid-cols-4">
        <MetaField label="ASN" value={host.asn ? `AS${host.asn}` : null} />
        <MetaField label="Org" value={host.org} />
        <MetaField label="Country" value={host.country} />
        <MetaField label="First seen" value={new Date(host.firstSeen * 1000).toLocaleString()} />
        <MetaField label="JARM" value={host.jarm} mono />
        <MetaField label="Cert serial" value={host.certSerial} mono />
        <MetaField label="Cert subject" value={host.certSubject} mono />
        <MetaField label="Last seen" value={new Date(host.lastSeen * 1000).toLocaleString()} />
      </div>

      {/* Triage controls */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">triage state (1–7)</p>
        <div className="flex flex-wrap gap-1">
          {TRIAGE_STATES.map((s, i) => (
            <button
              key={s}
              onClick={() => patch.mutate({ id, triageState: s })}
              className={`rounded border px-2 py-0.5 text-xs ${
                host.triageState === s
                  ? 'border-sky-600 bg-sky-900/40 text-sky-300'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="mr-1 text-zinc-600">{i + 1}</span>
              {TRIAGE_KEY_LABELS[String(i + 1)]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-500">notes (n)</label>
        <textarea
          ref={notesRef}
          defaultValue={host.notes ?? ''}
          rows={3}
          placeholder="Add analyst notes…"
          onBlur={(e) => {
            if (e.target.value !== (host.notes ?? '')) {
              patch.mutate({ id, notes: e.target.value });
            }
          }}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 focus:border-sky-600 focus:outline-none"
        />
      </div>

      {/* Tabs: banner / changes / enrichments */}
      <div className="space-y-2">
        <div className="flex gap-4 border-b border-zinc-800 text-xs">
          {/* banner */}
          <button
            onClick={() => setActiveTab('banner')}
            className={`pb-1 ${
              activeTab === 'banner'
                ? 'border-b-2 border-sky-500 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            banner
            {latestObs && (
              <span className="ml-1 text-zinc-600">
                · {new Date(latestObs.observedAt * 1000).toLocaleDateString()}
              </span>
            )}
          </button>

          {/* changes — only shown when there are 2+ observations */}
          {hasChanges && (
            <button
              onClick={() => setActiveTab('changes')}
              className={`pb-1 ${
                activeTab === 'changes'
                  ? 'border-b-2 border-yellow-500 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              changes
              {diffs.length > 0 ? (
                <span className="ml-1 rounded bg-yellow-900/50 px-1 text-[10px] text-yellow-400">
                  {diffs.length}
                </span>
              ) : (
                <span className="ml-1 text-zinc-600">· none</span>
              )}
            </button>
          )}

          {/* enrichments */}
          <button
            onClick={() => setActiveTab('enrichments')}
            className={`pb-1 ${
              activeTab === 'enrichments'
                ? 'border-b-2 border-sky-500 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            enrichments
            <span className="ml-1 text-zinc-600">· {host.enrichments.length}</span>
          </button>

          {/* pivots */}
          <button
            onClick={() => { setActiveTab('pivots'); setPdnsEnabled(true); }}
            className={`pb-1 ${
              activeTab === 'pivots'
                ? 'border-b-2 border-purple-500 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            pivots
            {pivotEntries.length > 0 && (
              <span className="ml-1 text-zinc-600">· {pivotEntries.length}</span>
            )}
          </button>
        </div>

        {/* Banner tab */}
        {activeTab === 'banner' && (
          <div className="overflow-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-xs">
            {latestObs ? (
              <JsonViewer data={latestObs.banner} initialExpanded={true} />
            ) : (
              <p className="text-zinc-500">No observations yet.</p>
            )}
          </div>
        )}

        {/* Changes tab */}
        {activeTab === 'changes' && hasChanges && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>
                Comparing{' '}
                <span className="text-zinc-400">
                  {new Date(prevObs.observedAt * 1000).toLocaleString()}
                </span>
                {' '}→{' '}
                <span className="text-zinc-400">
                  {new Date(latestObs.observedAt * 1000).toLocaleString()}
                </span>
              </span>
            </div>

            {diffs.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Hashes differ but no top-level field changes detected.
                The banner may have nested changes — inspect manually below.
              </p>
            ) : (
              <div className="rounded border border-zinc-800 text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-zinc-600">
                      <th className="px-3 py-1.5 font-normal">field</th>
                      <th className="px-3 py-1.5 font-normal text-zinc-500">before</th>
                      <th className="px-3 py-1.5 font-normal text-zinc-500">after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.field} className="border-b border-zinc-800/50 align-top">
                        <td className="px-3 py-2 font-mono text-zinc-400">{d.field}</td>
                        <td className="max-w-[24rem] px-3 py-2">
                          <DiffValue value={d.before} variant="before" />
                        </td>
                        <td className="max-w-[24rem] px-3 py-2">
                          <DiffValue value={d.after} variant="after" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Pivots tab */}
        {activeTab === 'pivots' && (
          <PivotsTab
            host={host}
            pivotEntries={pivotEntries}
            pivotsLoading={pivotsLoading}
            executePivot={executePivot}
            pdnsRecords={pdnsRecords}
            pdnsLoading={pdnsLoading}
          />
        )}

        {/* Enrichments tab */}
        {activeTab === 'enrichments' && (
          <div className="space-y-2">
            {/* Enrich button */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => enrich.mutate(undefined)}
                disabled={enrich.isPending}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40"
              >
                {enrich.isPending ? 'queued…' : '⟳ enrich now'}
              </button>
              {enrich.isSuccess && (
                <span className="text-xs text-zinc-500">
                  queued · results appear in ~10s
                </span>
              )}
              {enrich.isError && (
                <span className="text-xs text-rose-400">
                  {(enrich.error as Error).message}
                </span>
              )}
            </div>

            {host.enrichments.length === 0 ? (
              <p className="text-xs text-zinc-500">No enrichments yet.</p>
            ) : (
              host.enrichments.map((e) => (
                <div key={e.id} className="rounded border border-zinc-800 bg-zinc-900 p-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{e.source}</span>
                    <span className="text-zinc-600">
                      {new Date(e.fetchedAt * 1000).toLocaleString()}
                    </span>
                  </div>
                  <JsonViewer data={e.data} initialExpanded={false} />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Observation history */}
      {host.observations.length > 1 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-zinc-400">
            Observation history ({host.observations.length})
          </h2>
          <ObservationList observations={host.observations} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-zinc-600">{label}: </span>
      <span className={`text-zinc-400 ${mono ? 'font-mono' : ''}`}>
        {value != null ? String(value) : '—'}
      </span>
    </div>
  );
}

/** Render a diff value — scalar inline, object/array as collapsed JSON. */
function DiffValue({ value, variant }: { value: unknown; variant: 'before' | 'after' }) {
  const colourClass = variant === 'before' ? 'text-rose-400' : 'text-emerald-400';

  if (value === undefined) {
    return <span className="italic text-zinc-600">(absent)</span>;
  }
  if (value === null || typeof value !== 'object') {
    return (
      <span className={`font-mono ${colourClass}`}>
        {JSON.stringify(value)}
      </span>
    );
  }
  return (
    <div className={colourClass}>
      <JsonViewer data={value as Record<string, unknown>} initialExpanded={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pivots tab
// ---------------------------------------------------------------------------

const PIVOT_LABELS: Record<PivotType, string> = {
  cert_serial:   'cert serial',
  jarm:          'JARM',
  favicon_hash:  'favicon hash',
  ja4x:          'JA4X',
  asn_port:      'ASN + port',
  cert_subject:  'cert subject CN',
};

function pivotFieldValue(host: Host, type: PivotType): string | null {
  switch (type) {
    case 'cert_serial':  return host.certSerial ?? null;
    case 'jarm':         return host.jarm ?? null;
    case 'favicon_hash': return host.faviconHash ?? null;
    case 'ja4x':         return host.ja4x ?? null;
    case 'asn_port':
      return host.asn && host.port ? `AS${host.asn}:${host.port}` : null;
    case 'cert_subject': {
      if (!host.certSubject) return null;
      try { return (JSON.parse(host.certSubject) as Record<string, unknown>)['CN'] as string ?? null; }
      catch { return null; }
    }
  }
}

interface PivotsTabProps {
  host: Host;
  pivotEntries: PivotEntry[];
  pivotsLoading: boolean;
  executePivot: ReturnType<typeof useExecutePivot>;
  pdnsRecords: { query?: string | null; answer?: string | null; type?: string | null; first_seen?: number | null; last_seen?: number | null }[];
  pdnsLoading: boolean;
}

function PivotsTab({
  host,
  pivotEntries,
  pivotsLoading,
  executePivot,
  pdnsRecords,
  pdnsLoading,
}: PivotsTabProps) {
  // Group existing pivots by type for the list view
  const byType = new Map<string, PivotEntry[]>();
  for (const p of pivotEntries) {
    const list = byType.get(p.pivotType) ?? [];
    list.push(p);
    byType.set(p.pivotType, list);
  }

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">find related hosts via Shodan</p>
        <div className="flex flex-wrap gap-1.5">
          {PIVOT_TYPES.map((type) => {
            const val = pivotFieldValue(host, type);
            const running = executePivot.isPending && executePivot.variables === type;
            return (
              <button
                key={type}
                disabled={!val || executePivot.isPending}
                onClick={() => executePivot.mutate(type)}
                title={val ?? `no ${PIVOT_LABELS[type]} on this host`}
                className={`rounded border px-2.5 py-0.5 text-xs transition-colors ${
                  val
                    ? 'border-zinc-700 text-zinc-400 hover:border-purple-600 hover:text-zinc-200'
                    : 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                }`}
              >
                {running ? '…' : `by ${PIVOT_LABELS[type]}`}
                {val && (
                  <span className="ml-1.5 font-mono text-[10px] text-zinc-600">
                    {val.length > 16 ? `${val.slice(0, 16)}…` : val}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {executePivot.isSuccess && (
          <p className="text-xs text-purple-400">
            Found {executePivot.data.data.found} host{executePivot.data.data.found !== 1 ? 's' : ''}
            {' '}({executePivot.data.data.shodanTotal} total in Shodan)
            {executePivot.data.data.newPivots > 0 && ` · ${executePivot.data.data.newPivots} new edges`}
          </p>
        )}
        {executePivot.isError && (
          <p className="text-xs text-rose-400">{(executePivot.error as Error).message}</p>
        )}
      </div>

      {/* Pivot list */}
      {pivotsLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : pivotEntries.length === 0 ? (
        <p className="text-xs text-zinc-600">No pivot edges recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {[...byType.entries()].map(([type, entries]) => (
            <div key={type}>
              <p className="mb-1 text-xs font-medium text-zinc-400">
                {PIVOT_LABELS[type as PivotType] ?? type}
                <span className="ml-1.5 font-mono text-[10px] text-zinc-600">
                  {entries[0]?.pivotValue ?? ''}
                </span>
              </p>
              <div className="space-y-1">
                {entries.map((p) => p.relatedHost && (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs"
                  >
                    <span className="text-zinc-500">{p.direction === 'out' ? '→' : '←'}</span>
                    <Link
                      to="/hosts/$id"
                      params={{ id: p.relatedHost.id }}
                      className="font-mono text-sky-400 hover:text-sky-300"
                    >
                      {p.relatedHost.ip}:{p.relatedHost.port}
                    </Link>
                    {p.relatedHost.hostname && (
                      <span className="text-zinc-600">{p.relatedHost.hostname}</span>
                    )}
                    <span className="text-zinc-500">{p.relatedHost.org ?? '—'}</span>
                    <TriageBadge state={p.relatedHost.triageState as Parameters<typeof TriageBadge>[0]['state']} />
                    <span className="ml-auto text-zinc-700">
                      {new Date(p.createdAt * 1000).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Validin pDNS */}
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">passive DNS (Validin)</p>
        {pdnsLoading ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : pdnsRecords.length === 0 ? (
          <p className="text-xs text-zinc-600">No pDNS records found.</p>
        ) : (
          <div className="overflow-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="px-3 py-1.5 font-normal">query</th>
                  <th className="px-3 py-1.5 font-normal">answer</th>
                  <th className="px-3 py-1.5 font-normal">type</th>
                  <th className="px-3 py-1.5 font-normal">first seen</th>
                  <th className="px-3 py-1.5 font-normal">last seen</th>
                </tr>
              </thead>
              <tbody>
                {pdnsRecords.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="px-3 py-1.5 font-mono text-zinc-300">{r.query ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-zinc-400">{r.answer ?? '—'}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{r.type ?? '—'}</td>
                    <td className="px-3 py-1.5 text-zinc-600">
                      {r.first_seen ? new Date(r.first_seen * 1000).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-600">
                      {r.last_seen ? new Date(r.last_seen * 1000).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ObservationList({ observations }: { observations: HostObservation[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {observations.map((obs) => (
        <div key={obs.id} className="rounded border border-zinc-800">
          <button
            onClick={() => setExpanded((p) => (p === obs.id ? null : obs.id))}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/40"
          >
            <span className="font-mono text-zinc-500">{obs.bannerHash.slice(0, 12)}…</span>
            <span className="flex items-center gap-3">
              <span className="text-zinc-600">{obs.source}</span>
              <span className="text-zinc-600">
                {new Date(obs.observedAt * 1000).toLocaleString()}
              </span>
              <span className="text-zinc-600">{expanded === obs.id ? '▾' : '▸'}</span>
            </span>
          </button>
          {expanded === obs.id && (
            <div className="border-t border-zinc-800 p-3">
              <JsonViewer data={obs.banner} initialExpanded={false} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
