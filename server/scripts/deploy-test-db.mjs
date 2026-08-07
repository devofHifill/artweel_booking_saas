/**
 * Applies migrations to the TEST database.
 *
 * Prisma reads DATABASE_URL and nothing else, so pointing it at the test
 * database means swapping that variable for the duration of one child
 * process. Doing it in Node rather than in a shell keeps the command
 * identical on Windows and CI.
 */
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set — check server/.env');
  process.exit(1);
}

const result = spawnSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: testUrl },
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
