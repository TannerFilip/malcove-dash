import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryList, useCreateQuery, useDeleteQuery } from '../hooks/useQueries';
import { useQuota } from '../hooks/useQuota';
import { QueryBuilder } from '../components/QueryBuilder';
import type { Query } from '../../shared/types';

export const Route = createFileRoute('/queries')({
  component: QueriesLayout,
});

/** Layout: render the detail page when on /queries/$id, list otherwise. */
function QueriesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Anything deeper than /queries is a detail page
  if (pathname !== '/queries') return <Outlet />;
  return <QueriesPage />;
}

function QueriesPage() {
  const { data: queries = [], isLoading } = useQueryList();
  const { data: quota } = useQuota();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-zinc-100">Saved Queries</h1>
        <div className="flex items-center gap-4">
          {/* Quota display */}
          {quota && (
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>
                <span className="text-zinc-300">{quota.data.queriesUsed}</span>
                {' '}queries run · {quota.data.month}
              </span>
              {quota.data.shodan && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span title="Remaining Shodan query credits">
                    <span className="text-zinc-300">{quota.data.shodan.query_credits}</span>
                    {' '}credits left
                  </span>
                  {quota.data.shodan.scan_credits != null && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span title="Remaining Shodan scan credits">
                        <span className="text-zinc-300">{quota.data.shodan.scan_credits}</span>
                        {' '}scan credits
                      </span>
                    </>
                  )}
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-500">
                    {quota.data.shodan.plan}
                  </span>
                </>
              )}
            </div>
          )}
          <button
            onClick={() => setShowForm((p) => !p)}
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            {showForm ? 'cancel' : '+ new query'}
          </button>
        </div>
      </div>

      {showForm && <CreateQueryForm onDone={() => setShowForm(false)} />}

      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : queries.length === 0 ? (
        <p className="text-xs text-zinc-500">No saved queries yet.</p>
      ) : (
        <QueryTable queries={queries} />
      )}
    </div>
  );
}

const MAX_RESULTS_OPTIONS = [100, 200, 500, 1000] as const;

function CreateQueryForm({ onDone }: { onDone: () => void }) {
  const create = useCreateQuery();
  const [name, setName] = useState('');
  const [queryString, setQueryString] = useState('');
  const [source, setSource] = useState<'shodan' | 'validin'>('shodan');
  const [maxResults, setMaxResults] = useState<100 | 200 | 500 | 1000>(100);
  const [showBuilder, setShowBuilder] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ name, queryString, source, maxResults });
    onDone();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Cobalt Strike JARM"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-sky-600 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'shodan' | 'validin')}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-sky-600 focus:outline-none"
          >
            <option value="shodan">Shodan</option>
            <option value="validin">Validin</option>
          </select>
        </div>
      </div>

      {/* Query string + builder toggle */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-400">Query string</label>
          {source === 'shodan' && (
            <button
              type="button"
              onClick={() => setShowBuilder((p) => !p)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {showBuilder ? 'hide builder' : '⊞ builder'}
            </button>
          )}
        </div>
        <input
          value={queryString}
          onChange={(e) => setQueryString(e.target.value)}
          required
          placeholder='e.g. product:"Cobalt Strike Beacon" port:443'
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-sky-600 focus:outline-none"
        />
        {showBuilder && (
          <QueryBuilder onInsert={(q) => { setQueryString(q); setShowBuilder(false); }} />
        )}
      </div>

      {/* Result limit */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-400">
            Max results per run
          </label>
          <span className="text-xs text-zinc-600">
            = {maxResults / 100} Shodan credit{maxResults > 100 ? 's' : ''} per run
          </span>
        </div>
        <div className="flex gap-1">
          {MAX_RESULTS_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMaxResults(n)}
              className={`rounded border px-3 py-0.5 text-xs transition-colors ${
                maxResults === n
                  ? 'border-sky-600 bg-sky-900/40 text-sky-300'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-sky-700 px-3 py-1 text-xs text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {create.isPending ? 'saving…' : 'save query'}
        </button>
      </div>
      {create.isError && (
        <p className="text-xs text-rose-400">{(create.error as Error).message}</p>
      )}
    </form>
  );
}

function QueryTable({ queries }: { queries: Query[] }) {
  const del = useDeleteQuery();

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-800 text-left text-zinc-500">
          <th className="pb-1 font-normal">name</th>
          <th className="pb-1 font-normal">source</th>
          <th className="pb-1 font-normal">query</th>
          <th className="pb-1 font-normal">limit</th>
          <th className="pb-1 font-normal">last run</th>
          <th className="pb-1 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {queries.map((q) => (
          <tr key={q.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
            <td className="py-1.5 pr-4">
              <Link
                to="/queries/$id"
                params={{ id: q.id }}
                className="text-sky-400 hover:text-sky-300"
              >
                {q.name}
              </Link>
            </td>
            <td className="py-1.5 pr-4 text-zinc-500">{q.source}</td>
            <td className="max-w-xs truncate py-1.5 pr-4 font-mono text-zinc-400">
              {q.queryString}
            </td>
            <td className="py-1.5 pr-4 text-zinc-500">{q.maxResults ?? 100}</td>
            <td className="py-1.5 pr-4 text-zinc-500">
              {q.lastRunAt ? new Date(q.lastRunAt * 1000).toLocaleString() : '—'}
            </td>
            <td className="py-1.5 text-right">
              <button
                onClick={() => del.mutate(q.id)}
                className="text-zinc-600 hover:text-rose-400"
                title="Delete query"
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
