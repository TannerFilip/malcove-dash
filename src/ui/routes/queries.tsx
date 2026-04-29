import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryList, useCreateQuery, useDeleteQuery } from '../hooks/useQueries';
import type { Query } from '../../shared/types';

export const Route = createFileRoute('/queries')({
  component: QueriesPage,
});

function QueriesPage() {
  const { data: queries = [], isLoading } = useQueryList();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-zinc-100">Saved Queries</h1>
        <button
          onClick={() => setShowForm((p) => !p)}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          {showForm ? 'cancel' : '+ new query'}
        </button>
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

function CreateQueryForm({ onDone }: { onDone: () => void }) {
  const create = useCreateQuery();
  const [name, setName] = useState('');
  const [queryString, setQueryString] = useState('');
  const [source, setSource] = useState<'shodan' | 'validin'>('shodan');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ name, queryString, source });
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
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">Query string</label>
        <input
          value={queryString}
          onChange={(e) => setQueryString(e.target.value)}
          required
          placeholder='e.g. product:"Cobalt Strike Beacon" port:443'
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-sky-600 focus:outline-none"
        />
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
