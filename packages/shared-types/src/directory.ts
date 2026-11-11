/** Reference data that users are attached to. Full management arrives in Phase 3. */
export interface OrganisationDto {
  id: string;
  name: string;
  code: string;
  state: string;
  status: 'active' | 'inactive';
}

export interface FacilityDto {
  id: string;
  organisationId: string;
  name: string;
  code: string;
  type: 'phc' | 'general_hospital' | 'other';
  lga: string;
  ward: string | null;
  status: 'active' | 'inactive';
}

export interface CommunityDto {
  id: string;
  organisationId: string;
  name: string;
  lga: string;
  ward: string | null;
  status: 'active' | 'inactive';
}
