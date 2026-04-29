import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useChangesFeed } from '../hooks/useChanges';
import { TriageBadge } from '../components/TriageBadge';
import type { ChangeEntry } from '../hooks/useChanges';

// ---------------------------------------------------------------------------
// Search params schema
// ---------------------------------------------------------------------------

const ChangesSearchSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  page: z.coerce.number().min(1).default(1),
});

export const Route = createFileRoute('/changes')({
  validateSearch: ChangesSearchSchema,
  component: ChangesPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const DAY_OPTIONS = [1, 7, 30] as const;

function ChangesPage() {
  const navigate = useNavigate({ from: '/changes' });
  const search = Route.useSearch();

  const { data, isLoading } = useChangesFeed({
    days: search.days,
    page: search.page,
    pageSize: 50,
  });

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  function setPage(p: number) {
    void navigate({ search: (prev) => ({ ...prev, page: p }) });
  }

  function setDays(d: number) {
    void navigate({ search: (_prev) => ({ days: d, page: 1 }) });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header + time-range selector */}
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-zinc-300">Changes feed</h1>
        <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2.5 py-0.5 transition-colors ${
                search.days === d
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-600">
          {total} changed host{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Feed table */}
      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="mt-8 text-center text-xs text-zinc-600">
          <p>No changes detected in the last {search.days === 1 ? '24 hours' : `${search.days} days`}.</p>
          <p className="mt-1 text-zinc-700">
            Changes appear here after query runs or nightly rechecks find a different banner hash.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950">
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-1 font-normal">host</th>
                <th className="pb-1 font-normal">org</th>
                <th className="pb-1 font-normal">state</th>
                <th className="pb-1 font-normal">source</th>
                <th className="pb-1 font-normal">changed at</th>
                <th className="pb-1 font-normal">diff</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <ChangeRow key={`${entry.id}-${entry.changedAt}`} entry={entry} />
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
            onClick={() => setPage(search.page - 1)}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            ← prev
          </button>
          <span className="text-xs text-zinc-600">
            page {search.page} / {Math.ceil(total / 50)}
          </span>
          <button
            disabled={search.page >= Math.ceil(total / 50)}
            onClick={() => setPage(search.page + 1)}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            next →
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeRow({ entry }: { entry: ChangeEntry }) {
  const oldShort = entry.oldHash.slice(0, 8);
  const newShort = entry.newHash.slice(0, 8);

  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
      <td className="py-1.5 pr-4">
        <Link
          to="/hosts/$id"
          params={{ id: entry.id }}
          search={{ tab: 'changes' } as Record<string, unknown>}
          className="font-mono text-sky-400 hover:text-sky-300"
        >
          {entry.ip}:{entry.port}
        </Link>
        {entry.hostname && (
          <span className="ml-2 text-zinc-600">{entry.hostname}</span>
        )}
      </td>
      <td className="max-w-[14rem] truncate py-1.5 pr-4 text-zinc-400">
        {entry.org ?? '—'}
      </td>
      <td className="py-1.5 pr-4">
        <TriageBadge state={entry.triageState as Parameters<typeof TriageBadge>[0]['state']} />
      </td>
      <td className="py-1.5 pr-4">
        <SourceBadge source={entry.changeSource} />
      </td>
      <td className="py-1.5 pr-4 text-zinc-500">
        {new Date(entry.changedAt * 1000).toLocaleString()}
      </td>
      <td className="py-1.5 font-mono text-[10px]">
        <span className="text-rose-500">{oldShort}</span>
        <span className="mx-1 text-zinc-700">→</span>
        <span className="text-emerald-500">{newShort}</span>
      </td>
    </tr>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colours: Record<string, string> = {
    shodan: 'text-sky-400',
    recheck: 'text-yellow-400',
    validin: 'text-purple-400',
    external: 'text-zinc-400',
  };
  return (
    <span className={colours[source] ?? 'text-zinc-500'}>{source}</span>
  );
}
