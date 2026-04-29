import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useRef, useCallback } from 'react';
import { useHostDetail, usePatchHost } from '../hooks/useHosts';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { TriageBadge } from '../components/TriageBadge';
import { JsonViewer } from '../components/JsonViewer';
import { TRIAGE_STATES, type TriageState, type HostObservation } from '../../shared/types';

export const Route = createFileRoute('/hosts/$id')({
  component: HostDetailPage,
});

const TRIAGE_KEY_LABELS: Record<string, string> = {
  '1': 'new', '2': 'reviewing', '3': 'notable',
  '4': 'dismissed', '5': 'false_positive', '6': 'monitoring', '7': 'needs_followup',
};

function HostDetailPage() {
  const { id } = Route.useParams();
  const { data: host, isLoading, error } = useHostDetail(id);
  const patch = usePatchHost();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<'banner' | 'enrichments'>('banner');

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

      {/* Tabs: banner / enrichments */}
      <div className="space-y-2">
        <div className="flex gap-4 border-b border-zinc-800 text-xs">
          {(['banner', 'enrichments'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-1 ${
                activeTab === tab
                  ? 'border-b-2 border-sky-500 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
              {tab === 'banner' && latestObs && (
                <span className="ml-1 text-zinc-600">
                  ·{' '}
                  {new Date(latestObs.observedAt * 1000).toLocaleDateString()}
                </span>
              )}
              {tab === 'enrichments' && (
                <span className="ml-1 text-zinc-600">· {host.enrichments.length}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'banner' && (
          <div className="overflow-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-xs">
            {latestObs ? (
              <JsonViewer data={latestObs.banner} initialExpanded={true} />
            ) : (
              <p className="text-zinc-500">No observations yet.</p>
            )}
          </div>
        )}

        {activeTab === 'enrichments' && (
          <div className="space-y-2">
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
