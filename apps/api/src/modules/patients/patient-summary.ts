import type { Types } from 'mongoose';
import type { PatientSummary } from '@caretrail/shared-types';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { ReferralModel } from '../referrals/referral.model.js';
import { PatientModel, type PatientDoc } from './patient.model.js';

/** Minimal patient facts for facility-facing views (no phone, household or consent). */
export async function patientSummaries(ids: Types.ObjectId[]): Promise<Map<string, PatientSummary>> {
  const docs = await PatientModel.find({ _id: { $in: ids } })
    .select('patientCode fullName sex dateOfBirth estimatedBirthYear carePathway pathwayDetails')
    .lean<PatientDoc[]>();
  return new Map(
    docs.map((p) => [
      String(p._id),
      {
        id: String(p._id),
        patientCode: p.patientCode,
        fullName: p.fullName,
        sex: p.sex,
        dateOfBirth: p.dateOfBirth ?? null,
        estimatedBirthYear: p.estimatedBirthYear ?? null,
        carePathway: p.carePathway,
        expectedDeliveryDate: p.pathwayDetails?.expectedDeliveryDate ?? null,
        deliveryDate: p.pathwayDetails?.deliveryDate ?? null,
      },
    ]),
  );
}

export const unknownPatient = (id: Types.ObjectId): PatientSummary => ({
  id: String(id),
  patientCode: '—',
  fullName: 'Unknown',
  sex: 'female',
  dateOfBirth: null,
  estimatedBirthYear: null,
  carePathway: 'caregiver',
  expectedDeliveryDate: null,
  deliveryDate: null,
});

/** True when a patient is linked to a facility through a referral to it or an appointment at it. */
export async function isPatientLinkedToFacility(patientId: Types.ObjectId | string, facilityId: Types.ObjectId): Promise<boolean> {
  const [ref, appt] = await Promise.all([
    ReferralModel.exists({ patientId, toFacilityId: facilityId }),
    AppointmentModel.exists({ patientId, facilityId }),
  ]);
  return Boolean(ref || appt);
}
