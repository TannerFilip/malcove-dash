import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-zinc-100">Hosts</h1>
      <p className="text-sm text-zinc-500">No hosts yet — run a query to populate this view.</p>
    </div>
  );
}
