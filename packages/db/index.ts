import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client.
 *
 * Cached on globalThis because Next.js dev reloads modules on every edit, and a
 * fresh PrismaClient per reload exhausts the Postgres connection pool within
 * minutes. In production a single instance is created normally.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
