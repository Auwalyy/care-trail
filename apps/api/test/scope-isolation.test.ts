/**
 * Regression tests for a scope bug found in Phase 3: building `{ _id: id, ...scopeFilter }` lets a
 * scope filter that keys on `_id` silently replace the requested id (a programme admin asking for
 * another organisation got their own back). Repositories must combine filters with withinScope.
 */
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildAccessScope } from '../src/modules/access/access-scope.js';
import { ChwRepository } from '../src/modules/chws/chw.repository.js';
import { OrganisationRepository } from '../src/modules/organisations/organisation.repository.js';
import { UserRepository } from '../src/modules/users/user.repository.js';
import { createCommunity, createOrganisation, createUser, useTestDatabase } from './support.js';

useTestDatabase();

describe('id lookups never escape the caller scope', () => {
  it('organisations: a programme admin cannot read another organisation by id', async () => {
    const orgA = await createOrganisation('ORGA');
    const orgB = await createOrganisation('ORGB');
    const progA = await createUser('programme_admin', { organisationId: orgA._id });
    const scope = buildAccessScope(progA);
    const repo = new OrganisationRepository();
    expect(await repo.findInScope(scope, String(orgB._id))).toBeNull();
    expect((await repo.findInScope(scope, String(orgA._id)))?.code).toBe('ORGA');
  });

  it('users: a CHW scope resolves only the CHW themself, whatever id is asked for', async () => {
    const org = await createOrganisation('ORG');
    const com = await createCommunity(org._id, 'Gwale');
    const chw = await createUser('chw', { organisationId: org._id, communityIds: [com._id] });
    const other = await createUser('chw', { organisationId: org._id, communityIds: [com._id] });
    const scope = buildAccessScope(chw);
    expect(await new UserRepository().findInScope(scope, other._id)).toBeNull();
    expect(await new ChwRepository().findInScope(scope, String(other._id))).toBeNull();
    expect((await new UserRepository().findInScope(scope, chw._id))?.email).toBe(chw.email);
    expect(await new UserRepository().findInScope(scope, new Types.ObjectId())).toBeNull();
  });
});
