import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les lecteurs de l'audit vivent dans `scripts/ops/` et portent leurs témoins à côté d'eux :
    // ils sont hors de `src/`, mais ce sont eux qui produisent les chiffres remontés au CEO.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database, so files must NOT run in
    // parallel — one file's wipe() would delete rows another is using, and the
    // failures look like flakiness. Pure unit tests cost nothing to serialize.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
