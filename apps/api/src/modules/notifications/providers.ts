import type { Env } from '../../config/env.js';
import type { Logger } from '../../utils/logger.js';

export interface OutgoingMessage {
  /** Our notification id; providers may pass it on as a client reference. */
  notificationId: string;
  /** E.164 phone number. Never logged. */
  to: string;
  text: string;
  language: 'en' | 'ha';
}

/** Thrown for failures worth retrying (network, provider 5xx, rate limits). */
export class TransientProviderError extends Error {}

/**
 * An SMS or voice gateway. Implement this for the contracted provider (e.g. a Nigerian SMS
 * aggregator with a registered sender ID) and register it in `createProviders`.
 * `send` resolves with the provider's message id, throws TransientProviderError to retry, or any
 * other error to fail permanently.
 */
export interface NotificationProvider {
  readonly name: string;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
}

/**
 * Development stand-in: writes one line WITHOUT the phone number or text and reports success.
 * Not allowed in production (env validation), because nothing is actually delivered.
 */
export class LogOnlyProvider implements NotificationProvider {
  constructor(
    readonly name: string,
    private readonly logger: Logger,
  ) {}
  async send(m: OutgoingMessage) {
    this.logger.info({ notificationId: m.notificationId, provider: this.name, length: m.text.length }, 'Notification written to log instead of being sent');
    return { providerMessageId: `log-${m.notificationId}` };
  }
}

export interface ProviderSet {
  sms: NotificationProvider | null;
  voice: NotificationProvider | null;
  /** Push needs device tokens and a push service; not built yet (decision A42). */
  push: NotificationProvider | null;
}

export function createProviders(env: Env, logger: Logger): ProviderSet {
  return {
    sms: env.SMS_PROVIDER === 'log' ? new LogOnlyProvider('log-sms', logger) : null,
    voice: env.VOICE_PROVIDER === 'log' ? new LogOnlyProvider('log-voice', logger) : null,
    push: null,
  };
}
