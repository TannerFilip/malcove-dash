import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <nav className="flex shrink-0 items-center gap-6 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-sm">
        <span className="font-bold tracking-wider text-sky-400">malcove</span>
        <Link
          to="/"
          className="text-zinc-400 hover:text-zinc-100 [&.active]:text-zinc-100"
        >
          hosts
        </Link>
        <Link
          to="/queries"
          className="text-zinc-400 hover:text-zinc-100 [&.active]:text-zinc-100"
        >
          queries
        </Link>
      </nav>
      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
