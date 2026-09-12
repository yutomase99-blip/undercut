import { defineConfig } from 'vite';

// The base path is set for project-page hosting on GitHub Pages, where the site
// is served from /<repo>/ rather than the domain root.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  build: { outDir: 'dist', emptyOutDir: true },
});
