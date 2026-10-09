import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Compila el panel admin directo a /public para que Express lo sirva estatico.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'assets',
    // Two pages: the private portal (index.html) and the public sales page (conoce/index.html,
    // served by the backend at /conoce and at "/" on LANDING_URL's host - see src/growth/routes.ts).
    rollupOptions: {
      input: {
        portal: resolve(__dirname, 'index.html'),
        conoce: resolve(__dirname, 'conoce/index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
