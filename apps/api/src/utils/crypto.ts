import { createHash, randomBytes } from 'node:crypto';

/** 256-bit URL-safe random token (refresh tokens, activation/reset tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are high-entropy, so a fast hash (not a password hash) is the right tool for lookup. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
