/**
 * Programme reports. Aggregates only: rows are facilities, communities, health workers, reasons
 * or months — never patients. Health workers are staff and appear by name.
 */
export const REPORT_KEYS = ['monthly', 'referrals', 'appointments', 'communities', 'chws', 'followups'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_INFO: Record<ReportKey, { title: string; description: string; facilityStaff: boolean }> = {
  monthly: { title: 'Monthly trend', description: 'Registrations, referrals, appointments and follow-ups per month.', facilityStaff: false },
  referrals: { title: 'Referrals by facility', description: 'How many referred patients arrived and were seen, by receiving facility.', facilityStaff: true },
  appointments: { title: 'Appointments by facility', description: 'Attendance and missed appointments, by facility.', facilityStaff: true },
  communities: { title: 'Communities', description: 'Registrations, referrals and follow-ups, by community.', facilityStaff: false },
  chws: { title: 'Health worker activity', description: 'Registrations, visits, referrals and follow-ups per health worker, with last sync.', facilityStaff: false },
  followups: { title: 'Follow-up outcomes', description: 'How follow-up tasks were resolved, by reason.', facilityStaff: false },
};

export type ReportColumnType = 'text' | 'number' | 'percent' | 'days' | 'datetime';
export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  /** One-line explanation shown as a tooltip and in the CSV header notes. */
  help?: string;
}
export type ReportCell = string | number | null;

export interface ReportDto {
  report: ReportKey;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Column totals (rates recomputed from totals, not averaged). Null when totals make no sense. */
  totals: Record<string, ReportCell> | null;
  filters: { organisationId: string; from: string; to: string; facilityId: string | null; communityId: string | null };
  generatedAt: string;
}
