import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueryDetail, useRunQuery } from '../hooks/useQueries';
import type { QueryRun } from '../../shared/types';

export const Route = createFileRoute('/queries/$id')({
  component: QueryDetailPage,
});

function QueryDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading, error } = useQueryDetail(id);
  const run = useRunQuery(id);

  if (isLoading) return <p className="text-xs text-zinc-500">Loading…</p>;
  if (error) return <p className="text-xs text-rose-400">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/queries" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← queries
        </Link>
        <h1 className="text-sm font-semibold text-zinc-100">{data.name}</h1>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-500">
          {data.source}
        </span>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
        <p className="font-mono text-xs text-zinc-300">{data.queryString}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded bg-sky-700 px-4 py-1.5 text-xs text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {run.isPending ? 'running…' : '▶ run now'}
        </button>
        {run.isSuccess && (
          <span className="text-xs text-zinc-400">
            {run.data.data.newCount} new · {run.data.data.changedCount} changed ·{' '}
            {run.data.data.totalCount} total
            {' — '}
            <Link
              to="/"
              search={{ runId: run.data.data.runId }}
              className="text-sky-400 hover:text-sky-300"
            >
              view results
            </Link>
          </span>
        )}
        {run.isError && (
          <span className="text-xs text-rose-400">{(run.error as Error).message}</span>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-zinc-400">Run history</h2>
        {data.runs.length === 0 ? (
          <p className="text-xs text-zinc-500">No runs yet.</p>
        ) : (
          <RunTable runs={data.runs} />
        )}
      </div>
    </div>
  );
}

function RunTable({ runs }: { runs: QueryRun[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-800 text-left text-zinc-500">
          <th className="pb-1 font-normal">ran at</th>
          <th className="pb-1 font-normal">total</th>
          <th className="pb-1 font-normal">new</th>
          <th className="pb-1 font-normal">changed</th>
          <th className="pb-1 font-normal">status</th>
          <th className="pb-1 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
            <td className="py-1.5 pr-4 text-zinc-400">
              {new Date(r.runAt * 1000).toLocaleString()}
            </td>
            <td className="py-1.5 pr-4 text-zinc-400">{r.totalCount ?? '—'}</td>
            <td className="py-1.5 pr-4 text-sky-400">{r.newCount ?? '—'}</td>
            <td className="py-1.5 pr-4 text-yellow-400">{r.changedCount ?? '—'}</td>
            <td className="py-1.5 pr-4">
              {r.errorMessage ? (
                <span className="text-rose-400" title={r.errorMessage}>
                  error
                </span>
              ) : (
                <span className="text-zinc-500">ok</span>
              )}
            </td>
            <td className="py-1.5">
              <Link
                to="/"
                search={{ runId: r.id }}
                className="text-zinc-500 hover:text-sky-400"
              >
                view
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
