import { Types, type QueryFilter } from 'mongoose';
import type { InstructionTemplateDto } from '@caretrail/shared-types';
import type { ApproveTemplateInput, CreateTemplateInput, ListTemplatesQuery, UpdateTemplateInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { changedFields, updateVersioned } from '../../utils/versioned.js';
import { organisationFilter, resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { UserModel } from '../users/user.model.js';
import { InstructionTemplateModel, type InstructionTemplateDoc } from './instruction-template.model.js';

async function toDtos(docs: InstructionTemplateDoc[]): Promise<InstructionTemplateDto[]> {
  const ids = [...new Set(docs.flatMap((d) => (d.approval ? [String(d.approval.recordedBy)] : [])))];
  const users = await UserModel.find({ _id: { $in: ids } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  const names = new Map(users.map((u) => [String(u._id), u.fullName]));
  return docs.map((d) => ({
    id: String(d._id),
    organisationId: String(d.organisationId),
    title: d.title,
    body: d.body,
    bodyHa: d.bodyHa ?? null,
    status: d.status,
    approval: d.approval
      ? {
          reviewerName: d.approval.reviewerName,
          reviewerCredentials: d.approval.reviewerCredentials,
          approvedOn: d.approval.approvedOn,
          recordedBy: { id: String(d.approval.recordedBy), name: names.get(String(d.approval.recordedBy)) ?? null },
        }
      : null,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export class InstructionTemplateService {
  constructor(private readonly deps: { audit: AuditService }) {}

  private canManage(auth: AuthContext) {
    return auth.permissions.has('referral:manage-templates');
  }

  /** Managers see all templates; everyone else (CHWs, facility staff) only approved ones. */
  private filter(auth: AuthContext, requestedOrg?: string): QueryFilter<InstructionTemplateDoc> {
    return { ...organisationFilter(auth.scope, requestedOrg), ...(this.canManage(auth) ? {} : { status: 'approved' }) };
  }

  async list(auth: AuthContext, query: ListTemplatesQuery) {
    const filter: QueryFilter<InstructionTemplateDoc> = { ...this.filter(auth, query.organisationId) };
    if (query.status && this.canManage(auth)) filter.status = query.status;
    if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(InstructionTemplateModel, filter, { ...query, sort: { status: 1, title: 1 } });
    return { items: await toDtos(items), total };
  }

  async get(auth: AuthContext, id: string): Promise<InstructionTemplateDto> {
    const doc = Types.ObjectId.isValid(id)
      ? await InstructionTemplateModel.findOne(withinScope<InstructionTemplateDoc>({ _id: id }, this.filter(auth))).lean<InstructionTemplateDoc>()
      : null;
    if (!doc) throw AppError.notFound('Instruction template');
    return (await toDtos([doc]))[0]!;
  }

  async create(auth: AuthContext, input: CreateTemplateInput, ctx: RequestContext): Promise<InstructionTemplateDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    const doc = (
      await InstructionTemplateModel.create({ organisationId, title: input.title, body: input.body, bodyHa: input.bodyHa ?? null, createdBy: auth.userId, updatedBy: auth.userId })
    ).toObject();
    await this.deps.audit.record({ action: 'referral_template.create', auth, organisationId, entityType: 'referral_template', entityId: doc._id }, ctx);
    return (await toDtos([doc]))[0]!;
  }

  async update(auth: AuthContext, id: string, input: UpdateTemplateInput, ctx: RequestContext): Promise<InstructionTemplateDto> {
    const current = await InstructionTemplateModel.findOne(withinScope<InstructionTemplateDoc>({ _id: id }, this.filter(auth))).lean<InstructionTemplateDoc>();
    if (!current) throw AppError.notFound('Instruction template');
    if (current.status === 'retired') throw new AppError('CONFLICT', 'Retired templates cannot be changed. Create a new one instead.');
    const { version, ...changes } = input;
    const $set: Partial<InstructionTemplateDoc> = { updatedBy: auth.userId };
    if (changes.title !== undefined) $set.title = changes.title;
    if (changes.body !== undefined) $set.body = changes.body;
    if (changes.bodyHa !== undefined) $set.bodyHa = changes.bodyHa ?? null;
    const textChanged = ['title', 'body', 'bodyHa'].some((k) => changes[k as keyof typeof changes] !== undefined);
    // Changed wording has not been reviewed: it goes back to draft and must be approved again.
    if (textChanged && current.status === 'approved') Object.assign($set, { status: 'draft', approval: null });
    if (changes.status === 'retired') $set.status = 'retired';

    const updated = await updateVersioned(InstructionTemplateModel, { _id: current._id }, version, { $set }, (d) => d);
    await this.deps.audit.record(
      { action: changes.status === 'retired' ? 'referral_template.retire' : 'referral_template.update', auth, organisationId: current.organisationId, entityType: 'referral_template', entityId: current._id, metadata: { fields: changedFields(changes), reapprovalNeeded: textChanged && current.status === 'approved' } },
      ctx,
    );
    return (await toDtos([updated]))[0]!;
  }

  async approve(auth: AuthContext, id: string, input: ApproveTemplateInput, ctx: RequestContext): Promise<InstructionTemplateDto> {
    const current = await InstructionTemplateModel.findOne(withinScope<InstructionTemplateDoc>({ _id: id }, this.filter(auth))).lean<InstructionTemplateDoc>();
    if (!current) throw AppError.notFound('Instruction template');
    if (current.status !== 'draft') throw new AppError('CONFLICT', current.status === 'approved' ? 'Already approved.' : 'Retired templates cannot be approved.');
    const updated = await updateVersioned(
      InstructionTemplateModel,
      { _id: current._id },
      input.version,
      { $set: { status: 'approved', approval: { reviewerName: input.reviewerName, reviewerCredentials: input.reviewerCredentials, approvedOn: input.approvedOn, recordedBy: auth.userId }, updatedBy: auth.userId } },
      (d) => d,
    );
    await this.deps.audit.record({ action: 'referral_template.approve', auth, organisationId: current.organisationId, entityType: 'referral_template', entityId: current._id }, ctx);
    return (await toDtos([updated]))[0]!;
  }
}
