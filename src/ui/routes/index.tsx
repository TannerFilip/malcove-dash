import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useRef, useCallback } from 'react';
import { z } from 'zod';
import { useHostList } from '../hooks/useHosts';
import { usePatchHost } from '../hooks/useHosts';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { KeyboardHelp } from '../components/KeyboardHelp';
import { TriageBadge } from '../components/TriageBadge';
import { TRIAGE_STATES, type Host, type TriageState } from '../../shared/types';

// ---------------------------------------------------------------------------
// Search params schema
// ---------------------------------------------------------------------------

const HostSearchSchema = z.object({
  triageState: z.enum(TRIAGE_STATES).optional(),
  runId: z.string().optional(),
  asn: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
});

export const Route = createFileRoute('/')({
  validateSearch: HostSearchSchema,
  component: HostsPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function HostsPage() {
  const navigate = useNavigate({ from: '/' });
  const search = Route.useSearch();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useHostList({
    triageState: search.triageState,
    runId: search.runId,
    asn: search.asn,
    page: search.page,
    pageSize: 50,
  });

  const hosts = data?.data ?? [];
  const total = data?.total ?? 0;
  const patch = usePatchHost();

  const selectedHost: Host | undefined = hosts[selectedIdx];

  const handleTriage = useCallback(
    (state: TriageState) => {
      if (!selectedHost) return;
      patch.mutate({ id: selectedHost.id, triageState: state });
    },
    [selectedHost, patch],
  );

  useKeyboardNav({
    onNext: () => setSelectedIdx((i) => Math.min(i + 1, hosts.length - 1)),
    onPrev: () => setSelectedIdx((i) => Math.max(i - 1, 0)),
    onTriage: handleTriage,
    onSearch: () => searchRef.current?.focus(),
    onHelp: () => setShowHelp((p) => !p),
    onEscape: () => setShowHelp(false),
  });

  function setFilter(key: string, value: string | undefined) {
    void navigate({ search: (prev) => ({ ...prev, [key]: value, page: 1 }) });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          placeholder="/ search  (not implemented yet)"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-sky-600 focus:outline-none"
          readOnly
        />
        <select
          value={search.triageState ?? ''}
          onChange={(e) => setFilter('triageState', e.target.value || undefined)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
        >
          <option value="">all states</option>
          {TRIAGE_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {search.runId && (
          <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            run: {search.runId.slice(0, 8)}…
            <button onClick={() => setFilter('runId', undefined)} className="text-zinc-600 hover:text-zinc-300">
              ✕
            </button>
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-600">
          {total} host{total !== 1 ? 's' : ''} · press ? for shortcuts
        </span>
      </div>

      {/* Host table */}
      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : hosts.length === 0 ? (
        <p className="text-xs text-zinc-500">No hosts match the current filters.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950">
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-1 font-normal">host</th>
                <th className="pb-1 font-normal">org</th>
                <th className="pb-1 font-normal">asn</th>
                <th className="pb-1 font-normal">country</th>
                <th className="pb-1 font-normal">state</th>
                <th className="pb-1 font-normal">last seen</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host, idx) => (
                <HostRow
                  key={host.id}
                  host={host}
                  selected={idx === selectedIdx}
                  onClick={() => setSelectedIdx(idx)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center gap-3 border-t border-zinc-800 pt-2">
          <button
            disabled={search.page <= 1}
            onClick={() => setFilter('page', String(search.page - 1))}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            ← prev
          </button>
          <span className="text-xs text-zinc-600">
            page {search.page} / {Math.ceil(total / 50)}
          </span>
          <button
            disabled={search.page >= Math.ceil(total / 50)}
            onClick={() => setFilter('page', String(search.page + 1))}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            next →
          </button>
        </div>
      )}
    </div>
  );
}

function HostRow({
  host,
  selected,
  onClick,
}: {
  host: Host;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer border-b border-zinc-800/50 ${
        selected ? 'bg-zinc-800' : 'hover:bg-zinc-800/30'
      }`}
    >
      <td className="py-1.5 pr-4">
        <Link
          to="/hosts/$id"
          params={{ id: host.id }}
          className="font-mono text-sky-400 hover:text-sky-300"
          onClick={(e) => e.stopPropagation()}
        >
          {host.ip}:{host.port}
        </Link>
        {host.hostname && (
          <span className="ml-2 text-zinc-600">{host.hostname}</span>
        )}
      </td>
      <td className="max-w-[16rem] truncate py-1.5 pr-4 text-zinc-400">{host.org ?? '—'}</td>
      <td className="py-1.5 pr-4 text-zinc-500">{host.asn ?? '—'}</td>
      <td className="py-1.5 pr-4 text-zinc-500">{host.country ?? '—'}</td>
      <td className="py-1.5 pr-4">
        <TriageBadge state={host.triageState} />
      </td>
      <td className="py-1.5 text-zinc-600">
        {new Date(host.lastSeen * 1000).toLocaleDateString()}
      </td>
    </tr>
  );
}
