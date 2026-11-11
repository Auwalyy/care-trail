import type { ClientSession, Types } from 'mongoose';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AuditRepository } from './audit.repository.js';

export interface AuditEvent {
  action: string;
  outcome?: 'success' | 'failure';
  /** Signed-in actor, if any. */
  auth?: AuthContext | undefined;
  /** For unauthenticated events (login) where the actor is known. */
  actor?: { id: Types.ObjectId; role: string; organisationId?: Types.ObjectId | null } | undefined;
  organisationId?: Types.ObjectId | null | undefined;
  entityType?: string;
  entityId?: Types.ObjectId | null;
  /** Non-identifying details only (see AuditLogDoc.metadata). */
  metadata?: Record<string, unknown>;
  session?: ClientSession;
}

export class AuditService {
  constructor(private readonly repo = new AuditRepository()) {}

  async record(event: AuditEvent, ctx: RequestContext | null): Promise<void> {
    const actorId = event.auth?.userId ?? event.actor?.id ?? null;
    const actorRole = event.auth?.role ?? event.actor?.role ?? null;
    const organisationId =
      event.organisationId ?? event.auth?.user.organisationId ?? event.actor?.organisationId ?? null;
    await this.repo.insert(
      {
        action: event.action,
        outcome: event.outcome ?? 'success',
        actorId,
        actorRole,
        organisationId,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        requestId: ctx?.requestId ?? null,
        ip: ctx?.ip ?? null,
        metadata: event.metadata ?? null,
      },
      event.session,
    );
  }
}
