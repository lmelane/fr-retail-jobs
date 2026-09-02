import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database, so files must NOT run in
    // parallel — one file's wipe() would delete rows another is using, and the
    // failures look like flakiness. Pure unit tests cost nothing to serialize.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
