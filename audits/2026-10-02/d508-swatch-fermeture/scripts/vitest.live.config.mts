import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Configuration de la seule lecture réelle par l'adaptateur (D-508 §6) : jamais incluse dans les suites du dépôt. */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['lecture-a-blanc.live.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
