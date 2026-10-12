import { defineConfig } from 'vite';

// The Vite entry lives in app/ so that the repository root can hold a plain
// static redirect page instead of the unbundled development HTML entry.
// If GitHub Pages is pointed at the repository root, that redirect page opens
// the real dashboard in docs/ instead of showing a blank development screen.
export default defineConfig({
  root: 'app',
  publicDir: '../public',
  // Relative base so the same build works under /<repo>/, /<repo>/docs/ and a
  // local file-style preview.
  base: './',
  build: {
    outDir: '../docs',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});
