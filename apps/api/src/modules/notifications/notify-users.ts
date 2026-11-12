import type { ClientSession, Types } from 'mongoose';
import type { NotificationLink, NotificationTemplateKey } from '@caretrail/shared-types';
import { NotificationModel } from './notification.model.js';

export const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

/**
 * In-app messages to staff (escalations, new tasks). Idempotent through `dedupeKey`.
 * Runs inside other modules' transactions, so it upserts instead of relying on a duplicate-key
 * error (which would abort the surrounding transaction).
 */
export async function notifyUsers(
  n: { organisationId: Types.ObjectId; userIds: Types.ObjectId[]; templateKey: NotificationTemplateKey; params: Record<string, string>; link: NotificationLink | null; dedupeKey: string; createdBy?: Types.ObjectId | null },
  session?: ClientSession,
): Promise<void> {
  const now = new Date();
  for (const userId of n.userIds) {
    const dedupeKey = `${n.dedupeKey}:${String(userId)}`;
    await NotificationModel.updateOne(
      { dedupeKey },
      {
        $setOnInsert: {
          organisationId: n.organisationId,
          recipient: { type: 'user', id: userId },
          channel: 'in_app',
          templateKey: n.templateKey,
          params: n.params,
          language: 'en',
          link: n.link,
          status: 'delivered',
          attempts: 0,
          nextAttemptAt: null,
          claimedAt: null,
          lastError: null,
          provider: null,
          providerMessageId: null,
          scheduledFor: now,
          sentAt: now,
          readAt: null,
          dedupeKey,
          createdBy: n.createdBy ?? null,
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
  }
}
