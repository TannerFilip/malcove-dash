import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/queries')({
  component: QueriesPage,
});

function QueriesPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-zinc-100">Saved Queries</h1>
      <p className="text-sm text-zinc-500">No saved queries yet — coming in Phase 1.</p>
    </div>
  );
}
