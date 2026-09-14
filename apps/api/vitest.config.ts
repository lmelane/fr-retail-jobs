import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Même alias que tsconfig (`@/*` → racine de apps/web) : les modules
  // Intelligence importent `@/lib/jobs`, `@/lib/countries`…
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    // Database tests may publish a catalogue revision; serialize their fixtures.
    fileParallelism: false,
  },
});
