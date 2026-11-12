'use client';

import type { ReactNode } from 'react';
import { CARE_PATHWAY_LABELS, type ReferralDto } from '@caretrail/shared-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFacilities } from '@/features/directory/use-directory';
import { describeAge, formatDate } from '@/features/patients/patient-labels';
import { formatDateTime } from '@/features/users/labels';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-3 text-sm last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

/** Patient and referral facts — the minimal view a receiving facility needs. */
export function ReferralSummary({ r }: { r: ReferralDto }) {
  const facilities = useFacilities();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Patient</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            <Row label="Name">{r.patient.fullName}</Row>
            <Row label="Patient code"><span className="font-mono">{r.patient.patientCode}</span></Row>
            <Row label="Sex">{r.patient.sex === 'female' ? 'Female' : 'Male'}</Row>
            <Row label="Age">{describeAge(r.patient)}</Row>
            <Row label="Care pathway">{CARE_PATHWAY_LABELS[r.patient.carePathway]}</Row>
            {r.patient.expectedDeliveryDate && <Row label="Expected delivery">{formatDate(r.patient.expectedDeliveryDate)}</Row>}
            {r.patient.deliveryDate && <Row label="Delivered">{formatDate(r.patient.deliveryDate)}</Row>}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Referral</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            <Row label="To">{facilities.names.get(r.toFacilityId) ?? '—'}</Row>
            <Row label="Issued">{formatDateTime(r.issuedAt)}</Row>
            <Row label="Issued by">{r.issuedBy.name ?? '—'}</Row>
            <Row label="Expected by">{formatDate(r.expectedArrivalBy)}</Row>
            <Row label="Priority">{r.priority ? (r.priority === 'urgent' ? 'Urgent' : 'Routine') : 'Not set'}</Row>
          </dl>
          <div className="mt-4 grid gap-1.5">
            <p className="text-sm text-muted-foreground">Reason for referral</p>
            <p className="whitespace-pre-line rounded-lg bg-muted p-3 text-sm">{r.reason}</p>
          </div>
        </CardContent>
      </Card>
      {r.instructions.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Approved instructions</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {r.instructions.map((i) => (
                <li key={i.templateId} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{i.title}</p>
                  <p className="mt-1 whitespace-pre-line">{i.body}</p>
                  {i.bodyHa && <p lang="ha" className="mt-2 whitespace-pre-line text-muted-foreground">{i.bodyHa}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
