import { randomUUID } from 'node:crypto';
import { Types, type QueryFilter } from 'mongoose';
import { AUDIO_CONTENT_TYPES, EDUCATION_TRANSITIONS, MAX_AUDIO_BYTES, type AudioContentType, type EducationContentDto, type Language } from '@caretrail/shared-types';
import type { CreateEducationInput, EducationTransitionInput, ListEducationQuery, UpdateEducationInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { changedFields, updateVersioned } from '../../utils/versioned.js';
import { organisationFilter, resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { UserModel } from '../users/user.model.js';
import { EducationModel, type EducationAudio, type EducationDoc } from './education.model.js';

const audioDto = (a: EducationAudio | null) => (a ? { contentType: a.contentType, size: a.size, uploadedAt: a.uploadedAt.toISOString() } : null);

export async function toEducationDtos(docs: EducationDoc[]): Promise<EducationContentDto[]> {
  const ids = [...new Set(docs.flatMap((d) => (d.approval ? [String(d.approval.recordedBy)] : [])))];
  const users = ids.length ? await UserModel.find({ _id: { $in: ids } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>() : [];
  const names = new Map(users.map((u) => [String(u._id), u.fullName]));
  return docs.map((d) => ({
    id: String(d._id),
    organisationId: String(d.organisationId),
    category: d.category,
    title: d.title,
    body: d.body,
    titleHa: d.titleHa ?? null,
    bodyHa: d.bodyHa ?? null,
    audio: { en: audioDto(d.audio?.en ?? null), ha: audioDto(d.audio?.ha ?? null) },
    status: d.status,
    approval: d.approval
      ? { reviewerName: d.approval.reviewerName, reviewerCredentials: d.approval.reviewerCredentials, approvedOn: d.approval.approvedOn, recordedBy: { id: String(d.approval.recordedBy), name: names.get(String(d.approval.recordedBy)) ?? null } }
      : null,
    reviewNote: d.reviewNote ?? null,
    publishedAt: d.publishedAt?.toISOString() ?? null,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

/** First bytes of common audio containers. A wrong Content-Type header is rejected. */
function looksLikeAudio(buf: Buffer, type: AudioContentType): boolean {
  const ascii = (start: number, s: string) => buf.subarray(start, start + s.length).toString('latin1') === s;
  switch (type) {
    case 'audio/mpeg':
      return ascii(0, 'ID3') || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0);
    case 'audio/aac':
      return buf[0] === 0xff && ((buf[1] ?? 0) & 0xf6) === 0xf0;
    case 'audio/mp4':
      return ascii(4, 'ftyp');
    case 'audio/ogg':
      return ascii(0, 'OggS');
    case 'audio/wav':
      return ascii(0, 'RIFF') && ascii(8, 'WAVE');
    case 'audio/webm':
      return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  }
}

export class EducationService {
  constructor(private readonly deps: { audit: AuditService; storage: ObjectStorage }) {}

  private canManage(auth: AuthContext) {
    return auth.permissions.has('education:manage') || auth.permissions.has('education:approve');
  }

  /** Authors and reviewers see every status; everyone else sees published content only. */
  private filter(auth: AuthContext, requestedOrg?: string): QueryFilter<EducationDoc> {
    return { ...organisationFilter(auth.scope, requestedOrg), ...(this.canManage(auth) ? {} : { status: 'published' }) };
  }

  private async load(auth: AuthContext, id: string): Promise<EducationDoc> {
    const doc = Types.ObjectId.isValid(id) ? await EducationModel.findOne(withinScope<EducationDoc>({ _id: id }, this.filter(auth))).lean<EducationDoc>() : null;
    if (!doc) throw AppError.notFound('Education content');
    return doc;
  }

  async list(auth: AuthContext, query: ListEducationQuery) {
    const filter: QueryFilter<EducationDoc> = { ...this.filter(auth, query.organisationId) };
    if (query.status && this.canManage(auth)) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(EducationModel, filter, { ...query, sort: { category: 1, title: 1 } });
    return { items: await toEducationDtos(items), total };
  }

  async get(auth: AuthContext, id: string): Promise<EducationContentDto> {
    return (await toEducationDtos([await this.load(auth, id)]))[0]!;
  }

  async create(auth: AuthContext, input: CreateEducationInput, ctx: RequestContext): Promise<EducationContentDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    const doc = (
      await EducationModel.create({
        organisationId,
        category: input.category,
        title: input.title,
        body: input.body,
        titleHa: input.titleHa ?? null,
        bodyHa: input.bodyHa ?? null,
        audio: { en: null, ha: null },
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
    ).toObject();
    await this.deps.audit.record({ action: 'education.create', auth, organisationId, entityType: 'education', entityId: doc._id }, ctx);
    return (await toEducationDtos([doc]))[0]!;
  }

  /** Changing reviewed material sends it back to draft: what is published must be what was approved. */
  private reviewResetFor(current: EducationDoc): Partial<EducationDoc> {
    return current.status === 'approved' || current.status === 'published' || current.status === 'in_review'
      ? { status: 'draft', approval: null, publishedAt: null }
      : {};
  }

  async update(auth: AuthContext, id: string, input: UpdateEducationInput, ctx: RequestContext): Promise<EducationContentDto> {
    const current = await this.load(auth, id);
    if (current.status === 'archived') throw new AppError('CONFLICT', 'Archived content cannot be changed. Create a new item instead.');
    const { version, ...changes } = input;
    const merged = { titleHa: changes.titleHa !== undefined ? changes.titleHa : current.titleHa, bodyHa: changes.bodyHa !== undefined ? changes.bodyHa : current.bodyHa };
    if (Boolean(merged.titleHa) !== Boolean(merged.bodyHa)) {
      throw new AppError('VALIDATION_ERROR', 'Give both the Hausa title and the Hausa text, or neither', [{ path: 'bodyHa', message: 'Give both the Hausa title and the Hausa text, or neither' }]);
    }
    const $set: Partial<EducationDoc> = { updatedBy: auth.userId, ...this.reviewResetFor(current) };
    if (changes.category !== undefined) $set.category = changes.category;
    if (changes.title !== undefined) $set.title = changes.title;
    if (changes.body !== undefined) $set.body = changes.body;
    if (changes.titleHa !== undefined) $set.titleHa = changes.titleHa ?? null;
    if (changes.bodyHa !== undefined) $set.bodyHa = changes.bodyHa ?? null;
    const updated = await updateVersioned(EducationModel, { _id: current._id }, version, { $set }, (d) => d);
    await this.deps.audit.record(
      { action: 'education.update', auth, organisationId: current.organisationId, entityType: 'education', entityId: current._id, metadata: { fields: changedFields(changes), returnedToDraft: current.status !== 'draft' } },
      ctx,
    );
    return (await toEducationDtos([updated]))[0]!;
  }

  async transition(auth: AuthContext, id: string, input: EducationTransitionInput, ctx: RequestContext): Promise<EducationContentDto> {
    const current = await this.load(auth, id);
    const rule = EDUCATION_TRANSITIONS[input.action];
    // Reviewing is separate from authoring: only content approvers may return or approve.
    const needs = input.action === 'approve' || input.action === 'return' ? 'education:approve' : 'education:manage';
    if (!auth.permissions.has(needs)) throw AppError.forbidden(needs === 'education:approve' ? 'Only clinical content reviewers can do this.' : 'You cannot manage education content.');
    if (!rule.from.includes(current.status)) {
      throw new AppError('INVALID_TRANSITION', `Cannot ${input.action} content that is ${current.status.replace('_', ' ')}.`);
    }
    const $set: Partial<EducationDoc> = { status: rule.to, updatedBy: auth.userId };
    if (input.action === 'submit') $set.reviewNote = null;
    if (input.action === 'return') $set.reviewNote = input.note ?? null;
    if (input.action === 'approve') {
      $set.approval = { reviewerName: input.reviewerName!, reviewerCredentials: input.reviewerCredentials!, approvedOn: input.approvedOn!, recordedBy: auth.userId };
      $set.reviewNote = null;
    }
    if (input.action === 'publish') $set.publishedAt = new Date();
    if (input.action === 'unpublish' || input.action === 'archive') $set.publishedAt = null;
    const updated = await updateVersioned(EducationModel, { _id: current._id, status: current.status }, input.version, { $set }, (d) => d);
    await this.deps.audit.record({ action: `education.${input.action}`, auth, organisationId: current.organisationId, entityType: 'education', entityId: current._id, metadata: { from: current.status, to: rule.to } }, ctx);
    return (await toEducationDtos([updated]))[0]!;
  }

  async putAudio(auth: AuthContext, id: string, lang: Language, body: Buffer, contentType: string, version: number, ctx: RequestContext): Promise<EducationContentDto> {
    const current = await this.load(auth, id);
    if (current.status === 'archived') throw new AppError('CONFLICT', 'Archived content cannot be changed.');
    const type = contentType.split(';')[0]!.trim().toLowerCase() as AudioContentType;
    if (!(AUDIO_CONTENT_TYPES as readonly string[]).includes(type)) {
      throw new AppError('VALIDATION_ERROR', `Unsupported audio type. Use one of: ${AUDIO_CONTENT_TYPES.join(', ')}`, [{ path: 'audio', message: 'Unsupported audio type' }]);
    }
    if (!body.length) throw new AppError('VALIDATION_ERROR', 'The audio file is empty', [{ path: 'audio', message: 'The audio file is empty' }]);
    if (body.length > MAX_AUDIO_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Audio files can be at most 10 MB');
    if (!looksLikeAudio(body, type)) throw new AppError('VALIDATION_ERROR', 'The file does not look like the audio type it claims to be', [{ path: 'audio', message: 'File content does not match its type' }]);
    if (lang === 'ha' && !current.bodyHa) throw new AppError('VALIDATION_ERROR', 'Add the Hausa text before Hausa audio', [{ path: 'audio', message: 'Add the Hausa text first' }]);

    // A fresh key per upload: the old object is removed only after the record points elsewhere.
    const key = `education/${String(current.organisationId)}/${String(current._id)}/${lang}-${randomUUID()}`;
    await this.deps.storage.put(key, body, type);
    const audio: EducationAudio = { key, contentType: type, size: body.length, uploadedAt: new Date() };
    let updated: EducationDoc;
    try {
      updated = await updateVersioned(EducationModel, { _id: current._id }, version, { $set: { [`audio.${lang}`]: audio, updatedBy: auth.userId, ...this.reviewResetFor(current) } }, (d) => d);
    } catch (err) {
      await this.deps.storage.delete(key).catch(() => undefined);
      throw err;
    }
    const old = current.audio?.[lang];
    if (old) await this.deps.storage.delete(old.key).catch(() => undefined);
    await this.deps.audit.record({ action: 'education.audio.upload', auth, organisationId: current.organisationId, entityType: 'education', entityId: current._id, metadata: { lang, size: body.length, returnedToDraft: current.status !== 'draft' } }, ctx);
    return (await toEducationDtos([updated]))[0]!;
  }

  async deleteAudio(auth: AuthContext, id: string, lang: Language, version: number, ctx: RequestContext): Promise<EducationContentDto> {
    const current = await this.load(auth, id);
    const old = current.audio?.[lang];
    if (!old) throw AppError.notFound('Audio');
    const updated = await updateVersioned(EducationModel, { _id: current._id }, version, { $set: { [`audio.${lang}`]: null, updatedBy: auth.userId, ...this.reviewResetFor(current) } }, (d) => d);
    await this.deps.storage.delete(old.key).catch(() => undefined);
    await this.deps.audit.record({ action: 'education.audio.delete', auth, organisationId: current.organisationId, entityType: 'education', entityId: current._id, metadata: { lang } }, ctx);
    return (await toEducationDtos([updated]))[0]!;
  }

  async getAudio(auth: AuthContext, id: string, lang: Language): Promise<{ body: Buffer; contentType: string }> {
    const doc = await this.load(auth, id);
    const audio = doc.audio?.[lang];
    if (!audio) throw AppError.notFound('Audio');
    const body = await this.deps.storage.get(audio.key);
    if (!body) throw AppError.notFound('Audio');
    return { body, contentType: audio.contentType };
  }
}
