import { Schema, model, type Types } from 'mongoose';
import { LANGUAGES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES, NOTIFICATION_TEMPLATE_KEYS, type Language, type NotificationChannel, type NotificationLink, type NotificationStatus, type NotificationTemplateKey } from '@caretrail/shared-types';

/**
 * One message to one recipient on one channel. The text is rendered from `templateKey` + `params`
 * when it is sent, so no free text (and no medical detail) is ever stored or sent.
 * The phone number is never copied here: it is read from the patient record at send time, so a
 * corrected number or withdrawn consent applies to messages already queued.
 */
export interface NotificationDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  recipient: { type: 'patient' | 'user'; id: Types.ObjectId };
  channel: NotificationChannel;
  templateKey: NotificationTemplateKey;
  params: Record<string, string>;
  language: Language;
  link: NotificationLink | null;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
  scheduledFor: Date;
  sentAt: Date | null;
  readAt: Date | null;
  /** Makes automatic notifications idempotent (e.g. one reminder per appointment date). */
  dedupeKey: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    recipient: {
      type: new Schema({ type: { type: String, enum: ['patient', 'user'], required: true }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false }),
      required: true,
    },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    templateKey: { type: String, enum: NOTIFICATION_TEMPLATE_KEYS, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    language: { type: String, enum: LANGUAGES, default: 'ha' },
    link: { type: new Schema({ type: String, id: String }, { _id: false }), default: null },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    provider: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    scheduledFor: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'notifications', versionKey: false, minimize: false },
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ status: 1, scheduledFor: 1 });
notificationSchema.index({ 'recipient.type': 1, 'recipient.id': 1, channel: 1, createdAt: -1 });
notificationSchema.index({ organisationId: 1, createdAt: -1 });

export const NotificationModel = model<NotificationDoc>('Notification', notificationSchema);
