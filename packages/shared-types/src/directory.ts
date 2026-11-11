/** Reference data: organisations (tenants), facilities and communities. */
export type RecordStatus = 'active' | 'inactive';

export const FACILITY_TYPES = ['phc', 'general_hospital', 'other'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  phc: 'Primary Health Centre',
  general_hospital: 'General Hospital',
  other: 'Other',
};

export interface OrganisationDto {
  id: string;
  name: string;
  code: string;
  state: string;
  contactEmail: string | null;
  status: RecordStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FacilityDto {
  id: string;
  organisationId: string;
  name: string;
  code: string;
  type: FacilityType;
  lga: string;
  ward: string | null;
  address: string | null;
  phone: string | null;
  status: RecordStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityDto {
  id: string;
  organisationId: string;
  name: string;
  lga: string;
  ward: string | null;
  status: RecordStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
