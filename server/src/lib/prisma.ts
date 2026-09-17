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

/**
 * Development only, and NOT test — which is what this said before.
 *
 * Vitest runs every file in one worker thread, and `globalThis` is shared
 * across them even though the module registry is not. So the stash handed all
 * 59 files a single client, each one calling `$disconnect()` in its `afterAll`
 * and the next calling `$connect()` on the corpse. Prisma's library engine
 * does not reliably survive that cycle, and when it does not, the first query
 * of a file fails with "Engine is not yet connected" — in `beforeEach`, before
 * any assertion runs, in a file that passes perfectly on its own.
 *
 * Each test file now builds and disposes its own client, which is what the
 * per-file `$connect`/`$disconnect` pair already assumed it was doing.
 */
if (config.NODE_ENV === 'development') {
  globalForPrisma.prisma = prisma;
}
