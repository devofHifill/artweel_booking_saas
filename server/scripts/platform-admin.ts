/**
 * Grant, revoke and list platform (Artweel) admins.
 *
 *   npm run platform:grant  -- someone@example.com "on-call, ticket #42"
 *   npm run platform:revoke -- someone@example.com
 *   npm run platform:list
 *
 * This is a CLI script and not an API route on purpose. The first grant has to
 * come from somewhere, and an endpoint that mints platform admins is a
 * permanent privilege-escalation route sitting in the table waiting to be
 * found — protecting it would mean guarding it with the very authority it
 * hands out. Requiring shell access on the box is a stronger gate than any
 * check we could write, and it costs nothing: this runs about twice a year.
 */
import { prisma } from '../src/lib/prisma';
import {
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from '../src/modules/platform/platform.service';

/* eslint-disable no-console */

function usage(): never {
  console.error(
    [
      'Usage:',
      '  platform-admin grant  <email> [note]',
      '  platform-admin revoke <email>',
      '  platform-admin list',
    ].join('\n'),
  );
  process.exit(1);
}

async function main() {
  const [command, email, note] = process.argv.slice(2);

  if (!command) usage();

  switch (command) {
    case 'grant': {
      if (!email) usage();
      const result = await grantPlatformAdmin({ email, note });

      if (result.alreadyHad) {
        console.log(
          `${result.user.email} is already a platform admin (since ${result.grant.grantedAt.toISOString()}). Nothing to do.`,
        );
        break;
      }

      console.log(
        `Granted platform admin to ${result.user.email} (${result.user.name}).`,
      );
      console.log(
        'This account can now read and act on EVERY studio in the platform.',
      );
      break;
    }

    case 'revoke': {
      if (!email) usage();
      const result = await revokePlatformAdmin(email);

      console.log(
        result.revoked > 0
          ? `Revoked platform admin from ${result.user.email}.`
          : `${result.user.email} was not a platform admin. Nothing to do.`,
      );
      break;
    }

    case 'list': {
      const admins = await listPlatformAdmins();

      if (admins.length === 0) {
        console.log('No platform admins.');
        break;
      }

      console.log(`${admins.length} platform admin(s):`);
      for (const admin of admins) {
        const when = admin.grantedAt.toISOString().slice(0, 10);
        const why = admin.note ? ` — ${admin.note}` : '';
        console.log(`  ${admin.user.email}  (since ${when})${why}`);
      }
      break;
    }

    default:
      usage();
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
