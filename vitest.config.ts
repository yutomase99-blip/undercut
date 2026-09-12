import { defineConfig } from 'vitest/config';

// One run across every package, so a change in the engine is checked against
// the season layer that depends on it.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
