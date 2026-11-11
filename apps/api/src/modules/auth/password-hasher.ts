import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** `Algorithm.Argon2id` — an ambient const enum, which isolatedModules cannot inline. */
const ARGON2ID = 2 as Algorithm;

/**
 * Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1). Tuned for a modest
 * pilot server; raise memoryCost when hardware allows.
 */
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(hashValue: string, password: string): Promise<boolean> {
    try {
      return await verify(hashValue, password);
    } catch {
      return false;
    }
  }

  /**
   * Spend the same time as a real verification when there is no usable hash (unknown email,
   * inactive account) so response timing does not reveal which accounts exist.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('caretrail-timing-equaliser-not-a-real-password');
    await this.verify(await this.dummyHash, password);
  }
}
