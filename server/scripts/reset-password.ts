/**
 * Set a new password for a user, straight against the database.
 *
 *   npm run password:reset -- someone@example.com "the-new-password"
 *
 * A CLI script, not an API route, and for the same reason platform-admin is:
 * the one account that must never depend on the login working in order to fix
 * the login is the superadmin, and shell access to the box is a stronger gate
 * than anything an endpoint could check. It runs about never — a lockout, or a
 * handover.
 *
 * It reuses the app's own hashPassword, so the stored value carries the same
 * scrypt parameters a normal login would produce and verifies on the first
 * try. It does NOT invent a password: you pass the one you want, and it is the
 * caller's job to pass it somewhere it will not linger (see the note printed at
 * the end about shell history).
 *
 * It reports whether the account is a live platform admin, purely so you can
 * confirm you are pointing at the account you think you are before you commit
 * to it.
 */
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { isPlatformAdmin } from '../src/modules/platform/platform.service';

/* eslint-disable no-console */

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: password-reset <email> <new-password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Refusing a password under 8 characters.');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    console.error(`No user with email ${email}.`);
    process.exit(1);
  }

  const wasAdmin = await isPlatformAdmin(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`Password reset for ${user.email} (${user.name}).`);
  console.log(
    wasAdmin
      ? 'This account IS a live platform admin.'
      : 'This account is NOT a platform admin — check you meant this one.',
  );
  console.log(
    'Existing sessions still work until they expire; this only changes what the password is.',
  );
  console.log(
    'If you typed the password on the shell, clear it from history: the run is now in your shell log.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
