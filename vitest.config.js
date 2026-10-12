import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.js because the Vite build root is app/,
// while the test suite lives in tests/ at the repository root.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    reporters: 'default',
  },
});
