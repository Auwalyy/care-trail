import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

describe('reference data lists', () => {
  it('scopes organisations, facilities and communities to the caller', async () => {
    const { app } = buildTestApp();
    const orgA = await createOrganisation('ORGA');
    const orgB = await createOrganisation('ORGB');
    await createFacility(orgA._id, 'FA');
    await createFacility(orgB._id, 'FB');
    const comA = await createCommunity(orgA._id, 'Gwale');
    await createCommunity(orgB._id, 'Fagge');

    const platform = (await signIn(app, await createUser('platform_admin'))).bearer;
    const progA = (await signIn(app, await createUser('programme_admin', { organisationId: orgA._id }))).bearer;
    const chwA = (await signIn(app, await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] }))).bearer;

    const get = (path: string, bearer: string) => request(app).get(`/api/v1${path}`).set('Authorization', bearer);
    const codes = (res: request.Response, key: string) => (res.body.data as Record<string, string>[]).map((x) => x[key]).sort();

    expect(codes(await get('/organisations', platform), 'code')).toEqual(['ORGA', 'ORGB']);
    expect(codes(await get('/organisations', progA), 'code')).toEqual(['ORGA']);
    expect((await get('/organisations', chwA)).status).toBe(403);

    expect(codes(await get('/facilities', platform), 'code')).toEqual(['FA', 'FB']);
    expect(codes(await get(`/facilities?organisationId=${String(orgB._id)}`, platform), 'code')).toEqual(['FB']);
    // An explicit organisation filter cannot widen a programme admin's scope.
    expect(codes(await get(`/facilities?organisationId=${String(orgB._id)}`, progA), 'code')).toEqual(['FA']);
    expect(codes(await get('/facilities', chwA), 'code')).toEqual(['FA']);

    expect(codes(await get('/communities', progA), 'name')).toEqual(['Gwale']);
    expect(codes(await get('/communities', chwA), 'name')).toEqual(['Gwale']);
  });
});
