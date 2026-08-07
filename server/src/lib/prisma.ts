import { PrismaClient } from '@prisma/client';
import { config } from '../config';

/**
 * A single PrismaClient for the process.
 *
 * Under `tsx watch` the module graph is re-evaluated on every save, which
 * would otherwise leak a new connection pool per reload until Postgres
 * refuses connections. Stashing the client on globalThis in development
 * keeps exactly one pool alive across reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Silent under test: constraint rejections are the DESIGNED path there,
    // not failures, and logging every one buries the actual test results.
    log:
      config.NODE_ENV === 'test'
        ? []
        : config.NODE_ENV === 'development'
          ? ['warn', 'error']
          : ['error'],
  });

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
