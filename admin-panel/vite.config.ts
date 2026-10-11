import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Public sales site: conoce/index.html (home) plus one folder per extra page
 * (conoce/<slug>/index.html). The backend serves each at "/<slug>" - see src/growth/pages.ts,
 * which must list the same slugs.
 */
const SITE_DIR = resolve(__dirname, 'conoce');
const sitePages = Object.fromEntries(
  readdirSync(SITE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(SITE_DIR, d.name, 'index.html')))
    .map((d) => [`conoce-${d.name}`, resolve(SITE_DIR, d.name, 'index.html')]),
);

/** `<!-- @include header -->` -> conoce/partials/header.html (shared nav/footer of the public site). */
function htmlPartials(): Plugin {
  return {
    name: 'canix-html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name: string) =>
          readFileSync(resolve(SITE_DIR, 'partials', `${name}.html`), 'utf8'),
        ),
    },
  };
}

// Compila el panel admin directo a /public para que Express lo sirva estatico.
export default defineConfig({
  plugins: [htmlPartials(), react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'assets',
    // The private portal (index.html) and the public sales site (conoce/**/index.html, served by
    // the backend at "/" + "/<slug>" on LANDING_URL's host - see src/growth/routes.ts).
    rollupOptions: {
      input: {
        portal: resolve(__dirname, 'index.html'),
        conoce: resolve(SITE_DIR, 'index.html'),
        ...sitePages,
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
