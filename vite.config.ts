import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';

export default defineConfig({
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routesDirectory: './src/ui/routes',
      generatedRouteTree: './src/ui/routeTree.gen.ts',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  // Vite serves the SPA; Pages Functions handles /api/* separately
  server: {
    port: 5173,
  },
});
