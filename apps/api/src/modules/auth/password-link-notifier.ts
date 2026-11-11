import type { Types } from 'mongoose';
import type { Logger } from '../../utils/logger.js';
import type { PasswordTokenPurpose } from './password-token.model.js';

export interface PasswordLinkMessage {
  userId: Types.ObjectId;
  email: string;
  purpose: PasswordTokenPurpose;
  url: string;
  expiresAt: string;
}

/** Delivers self-service password links (email/SMS provider plugs in here — Phase 9). */
export interface PasswordLinkNotifier {
  send(message: PasswordLinkMessage): Promise<{ delivered: boolean }>;
}

/**
 * Used until a delivery provider is configured. Nothing is sent, and that is recorded honestly.
 * In development only, the link is logged so the flow can be exercised locally. In every other
 * environment administrators issue reset links from the user management screen instead.
 */
export class LogOnlyPasswordLinkNotifier implements PasswordLinkNotifier {
  constructor(
    private readonly logger: Logger,
    private readonly exposeLinksInLogs: boolean,
  ) {}

  async send(message: PasswordLinkMessage): Promise<{ delivered: boolean }> {
    if (this.exposeLinksInLogs) {
      this.logger.warn(
        { userId: String(message.userId), purpose: message.purpose, devOnlyLink: message.url },
        'DEVELOPMENT ONLY: password link (no delivery provider configured)',
      );
    } else {
      this.logger.info(
        { userId: String(message.userId), purpose: message.purpose },
        'Password link requested but not delivered: no delivery provider configured',
      );
    }
    return { delivered: false };
  }
}
