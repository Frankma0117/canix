import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Public sales site: landing/index.html (home) plus one folder per extra page
 * (landing/<slug>/index.html). The backend serves each at "/<slug>" - see
 * backend/src/services/growth/site.service.ts, whose SITE_PAGES must list the same slugs.
 */
const SITE_DIR = resolve(__dirname, 'landing');
const sitePages = Object.fromEntries(
  readdirSync(SITE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(SITE_DIR, d.name, 'index.html')))
    .map((d) => [`landing-${d.name}`, resolve(SITE_DIR, d.name, 'index.html')]),
);

/** `<!-- @include header -->` -> landing/partials/header.html (shared nav/footer of the public site). */
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

// Builds straight into the repo-level /public folder, which the backend serves statically.
export default defineConfig({
  plugins: [htmlPartials(), react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'assets',
    // The private portal (index.html) and the public sales site (landing/**/index.html, served by
    // the backend at "/" + "/<slug>" on LANDING_URL's host - see backend/src/api/routes/growth.routes.ts).
    rollupOptions: {
      input: {
        portal: resolve(__dirname, 'index.html'),
        landing: resolve(SITE_DIR, 'index.html'),
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
