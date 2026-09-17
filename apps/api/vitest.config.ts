import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Même alias que tsconfig (`@/*` → racine de apps/api) : les routes et les
  // témoins importent `@/lib/jobs`, `@/lib/cle-api`…
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    // Database tests may publish a catalogue revision; serialize their fixtures.
    fileParallelism: false,
  },
});
