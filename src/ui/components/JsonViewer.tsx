import { useState } from 'react';

interface Props {
  data: unknown;
  initialExpanded?: boolean;
}

export function JsonViewer({ data, initialExpanded = true }: Props) {
  return <Node value={data} depth={0} initialExpanded={initialExpanded} />;
}

function Node({
  value,
  depth,
  initialExpanded,
}: {
  value: unknown;
  depth: number;
  initialExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded || depth < 2);

  if (value === null) return <span className="text-zinc-500">null</span>;
  if (typeof value === 'boolean') return <span className="text-violet-400">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-sky-400">{value}</span>;
  if (typeof value === 'string') return <span className="text-green-400">"{value}"</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    return (
      <span>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? '▾' : '▸'} [{value.length}]
        </button>
        {expanded && (
          <div className="ml-4 border-l border-zinc-800 pl-2">
            {value.map((item, i) => (
              <div key={i}>
                <span className="text-zinc-600">{i}: </span>
                <Node value={item} depth={depth + 1} initialExpanded={initialExpanded} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-zinc-500">{'{}'}</span>;
    return (
      <span>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? '▾' : '▸'} {'{'}
          {entries.length}
          {'}'}
        </button>
        {expanded && (
          <div className="ml-4 border-l border-zinc-800 pl-2">
            {entries.map(([k, v]) => (
              <div key={k}>
                <span className="text-zinc-400">"{k}"</span>
                <span className="text-zinc-600">: </span>
                <Node value={v} depth={depth + 1} initialExpanded={initialExpanded} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span className="text-zinc-300">{String(value)}</span>;
}
