/**
 * Creates a platform administrator. This is the only way to create one; the API never can.
 *
 *   npm run create-admin -w @caretrail/api
 *
 * Non-interactive (CI / provisioning): set CARETRAIL_ADMIN_EMAIL, CARETRAIL_ADMIN_NAME and
 * CARETRAIL_ADMIN_PASSWORD. Refuses to create a second platform admin unless
 * --allow-additional is passed.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { emailSchema, passwordSchema } from '@caretrail/validation';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { PasswordHasher } from '../modules/auth/password-hasher.js';
import { UserModel } from '../modules/users/user.model.js';
import { createLogger } from '../utils/logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const r = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    r._writeToOutput = (s: string) => {
      if (s.startsWith(question)) r.output.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    }),
  );
}

async function main() {
  const env = loadEnv();
  const logger = createLogger({ level: 'warn' });
  await connectDatabase({ uri: env.MONGODB_URI, logger });

  try {
    const existing = await UserModel.countDocuments({ role: 'platform_admin' });
    if (existing > 0 && !process.argv.includes('--allow-additional')) {
      console.error(`${existing} platform administrator(s) already exist. Re-run with --allow-additional to add another.`);
      process.exitCode = 1;
      return;
    }

    const email = emailSchema.parse(process.env.CARETRAIL_ADMIN_EMAIL ?? (await ask('Email: ')));
    const fullName = (process.env.CARETRAIL_ADMIN_NAME ?? (await ask('Full name: '))).trim();
    if (fullName.length < 2) throw new Error('Full name is required');

    let password = process.env.CARETRAIL_ADMIN_PASSWORD;
    if (!password) {
      password = await ask('Password (min 10 characters): ', true);
      const confirm = await ask('Confirm password: ', true);
      if (password !== confirm) throw new Error('Passwords do not match');
    }
    const check = passwordSchema.safeParse(password);
    if (!check.success) throw new Error(check.error.issues.map((i) => i.message).join('; '));

    const passwordHash = await new PasswordHasher().hash(password);
    const user = await UserModel.create({
      email,
      fullName,
      role: 'platform_admin',
      status: 'active',
      passwordHash,
      passwordChangedAt: new Date(),
    });
    await new AuditService().record(
      { action: 'user.create', actor: { id: user._id, role: 'platform_admin' }, entityType: 'user', entityId: user._id, metadata: { role: 'platform_admin', via: 'bootstrap_script' } },
      null,
    );
    console.log(`Platform administrator created (id ${String(user._id)}).`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  const message =
    (err as { code?: number }).code === 11000
      ? 'A user with that email already exists.'
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`Failed: ${message}`);
  process.exit(1);
});
