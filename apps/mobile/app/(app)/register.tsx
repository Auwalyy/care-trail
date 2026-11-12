import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { CARE_PATHWAY_LABELS, CONSENT_PURPOSE_LABELS, CONSENT_PURPOSES, type CarePathway, type ConsentPurpose } from '@caretrail/shared-types';
import { Button, Card, Choice, Field, Screen, Title, Toggle } from '@/components/ui';
import { LocalValidationError, clearDraft, listCommunities, listHouseholds, loadDraft, localDuplicates, registerPatientOffline, saveDraft, syncSettings, type FieldErrors } from '@/database/repo';
import { useChw } from '@/hooks/use-chw';
import { scheduleSync } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

interface Draft {
  fullName: string;
  sex: 'female' | 'male';
  ageMode: 'estimate' | 'dob';
  estimatedAge: string;
  dateOfBirth: string;
  phone: string;
  phoneOwner: 'self' | 'household';
  preferredLanguage: 'ha' | 'en';
  communityId: string;
  householdMode: 'none' | 'new' | 'existing';
  householdId: string;
  landmark: string;
  carePathway: CarePathway;
  expectedDeliveryDate: string;
  deliveryDate: string;
  purposes: Record<ConsentPurpose, boolean>;
  consentMethod: 'verbal' | 'thumbprint' | 'signature';
  witnessName: string;
}

const EMPTY: Draft = {
  fullName: '', sex: 'female', ageMode: 'estimate', estimatedAge: '', dateOfBirth: '', phone: '', phoneOwner: 'self', preferredLanguage: 'ha',
  communityId: '', householdMode: 'none', householdId: '', landmark: '', carePathway: 'antenatal', expectedDeliveryDate: '', deliveryDate: '',
  purposes: { care_coordination: false, sms: false, voice: false, facility_sharing: false }, consentMethod: 'verbal', witnessName: '',
};

const STEPS = ['Patient', 'Contact', 'Community', 'Care pathway', 'Consent', 'Review'] as const;
/** Which step owns each validation path, so errors take the CHW back to the right page. */
const STEP_OF: Record<string, number> = { fullName: 0, sex: 0, dateOfBirth: 0, estimatedAge: 0, phone: 1, communityId: 2, 'household.householdId': 2, 'pathwayDetails.expectedDeliveryDate': 3, 'pathwayDetails.deliveryDate': 3, carePathway: 3, 'consent.purposes.care_coordination': 4, 'consent.consentTextVersion': 4 };

export default function Register() {
  const t = useT();
  const router = useRouter();
  const chw = useChw();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const communities = useLocalQuery(listCommunities).data ?? [];
  const households = useLocalQuery(() => (d.communityId ? listHouseholds(d.communityId) : Promise.resolve([])), [d.communityId]).data ?? [];

  useEffect(() => {
    void loadDraft<{ step: number; d: Draft }>('registration').then((saved) => {
      if (saved) {
        setD({ ...EMPTY, ...saved.d });
        setStep(saved.step);
      }
    });
  }, []);
  const update = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const go = (n: number) => {
    setStep(n);
    void saveDraft('registration', { step: n, d }); // local draft: nothing is lost if interrupted
  };

  const save = async (confirmNotDuplicate = false) => {
    setBusy(true);
    setErrors({});
    try {
      const settings = await syncSettings();
      const birthYear = d.ageMode === 'dob' ? Number(d.dateOfBirth.slice(0, 4)) : new Date().getUTCFullYear() - Number(d.estimatedAge || 0);
      if (!confirmNotDuplicate) {
        const dups = await localDuplicates(d.fullName, birthYear, d.communityId);
        if (dups.length) {
          setBusy(false);
          Alert.alert(t('possibleDuplicate'), dups.map((p) => `${p.fullName} · ${p.patientCode}`).join('\n'), [
            { text: t('back'), style: 'cancel' },
            { text: t('registerAnyway'), onPress: () => void save(true) },
          ]);
          return;
        }
      }
      const id = await registerPatientOffline(
        {
          fullName: d.fullName,
          sex: d.sex,
          ...(d.ageMode === 'dob' ? { dateOfBirth: d.dateOfBirth } : { estimatedAge: d.estimatedAge === '' ? null : Number(d.estimatedAge) }),
          phone: d.phone || null,
          phoneOwner: d.phone ? d.phoneOwner : 'none',
          communityId: d.communityId,
          household: d.householdMode === 'existing' ? { mode: 'existing', householdId: d.householdId } : d.householdMode === 'new' ? { mode: 'new', landmark: d.landmark || null } : { mode: 'none' },
          carePathway: d.carePathway,
          pathwayDetails: { expectedDeliveryDate: d.expectedDeliveryDate || null, deliveryDate: d.deliveryDate || null },
          preferredLanguage: d.preferredLanguage,
          preferredChannel: 'none',
          confirmNotDuplicate,
          consent: { purposes: d.purposes, method: d.consentMethod, consentTextVersion: settings?.consentTextVersion ?? '', language: d.preferredLanguage, witnessName: d.witnessName || null },
        },
        chw,
        chw.organisationId,
      );
      await clearDraft('registration');
      scheduleSync();
      router.replace({ pathname: '/patient/[id]', params: { id } });
    } catch (err) {
      if (err instanceof LocalValidationError) {
        setErrors(err.fields);
        const first = Math.min(...Object.keys(err.fields).map((k) => STEP_OF[k] ?? 5));
        setStep(first);
      } else Alert.alert('Error', String(err));
    } finally {
      setBusy(false);
    }
  };

  const e = (k: string) => errors[k];
  return (
    <Screen>
      <Title sub={`${step + 1} / ${STEPS.length} · ${STEPS[step]}`}>{t('registerPatient')}</Title>
      <View className="h-2 overflow-hidden rounded-full bg-border">
        <View className="h-2 bg-brand-600" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </View>

      <Card className="gap-4">
        {step === 0 && (
          <>
            <Field label="Full name" value={d.fullName} onChangeText={(v) => update({ fullName: v })} error={e('fullName')} />
            <Choice label="Sex" value={d.sex} onChange={(v) => update({ sex: v })} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} error={e('sex')} />
            <Choice label="Age" value={d.ageMode} onChange={(v) => update({ ageMode: v })} options={[{ value: 'estimate', label: 'Estimated age' }, { value: 'dob', label: 'Date of birth known' }]} />
            {d.ageMode === 'estimate'
              ? <Field label="Estimated age (years)" value={d.estimatedAge} onChangeText={(v) => update({ estimatedAge: v.replace(/\D/g, '') })} keyboardType="number-pad" error={e('dateOfBirth') ?? e('estimatedAge')} />
              : <Field label="Date of birth (YYYY-MM-DD)" value={d.dateOfBirth} onChangeText={(v) => update({ dateOfBirth: v })} placeholder="2001-05-04" error={e('dateOfBirth')} />}
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Phone (optional)" value={d.phone} onChangeText={(v) => update({ phone: v })} keyboardType="phone-pad" error={e('phone')} />
            {d.phone ? <Choice label="Whose phone?" value={d.phoneOwner} onChange={(v) => update({ phoneOwner: v })} options={[{ value: 'self', label: 'Their own' }, { value: 'household', label: 'Household' }]} /> : null}
            <Choice label={t('language')} value={d.preferredLanguage} onChange={(v) => update({ preferredLanguage: v })} options={[{ value: 'ha', label: 'Hausa' }, { value: 'en', label: 'English' }]} />
          </>
        )}
        {step === 2 && (
          <>
            <Choice label="Community" value={d.communityId || null} onChange={(v) => update({ communityId: v, householdId: '' })} options={communities.map((c) => ({ value: c.id, label: c.name }))} error={e('communityId')} />
            <Choice label="Household" value={d.householdMode} onChange={(v) => update({ householdMode: v })} options={[{ value: 'none', label: 'Not recorded' }, { value: 'new', label: 'New household' }, { value: 'existing', label: 'Existing' }]} />
            {d.householdMode === 'new' ? <Field label="Landmark / directions" value={d.landmark} onChangeText={(v) => update({ landmark: v })} /> : null}
            {d.householdMode === 'existing' ? <Choice label="Household" value={d.householdId || null} onChange={(v) => update({ householdId: v })} options={households.map((h) => ({ value: h.id, label: `${h.householdCode}${h.landmark ? ` · ${h.landmark}` : ''}` }))} error={e('household.householdId')} /> : null}
          </>
        )}
        {step === 3 && (
          <>
            <Choice label="Care pathway" value={d.carePathway} onChange={(v) => update({ carePathway: v })} options={(['antenatal', 'postnatal', 'newborn', 'caregiver'] as const).map((p) => ({ value: p, label: CARE_PATHWAY_LABELS[p] }))} error={e('carePathway') ?? e('sex')} />
            {d.carePathway === 'antenatal' ? <Field label="Expected delivery date (YYYY-MM-DD)" value={d.expectedDeliveryDate} onChangeText={(v) => update({ expectedDeliveryDate: v })} error={e('pathwayDetails.expectedDeliveryDate')} /> : null}
            {d.carePathway === 'postnatal' ? <Field label="Delivery date (YYYY-MM-DD)" value={d.deliveryDate} onChangeText={(v) => update({ deliveryDate: v })} error={e('pathwayDetails.deliveryDate')} /> : null}
            {d.carePathway === 'newborn' ? <Text className="text-base text-ink-muted">Go back and enter the baby&apos;s date of birth.</Text> : null}
          </>
        )}
        {step === 4 && (
          <>
            <Text className="text-base text-ink-muted">Read the approved consent wording to the person, then record each answer.</Text>
            {CONSENT_PURPOSES.map((p) => (
              <Toggle key={p} label={CONSENT_PURPOSE_LABELS[p]} value={d.purposes[p]} onChange={(v) => update({ purposes: { ...d.purposes, [p]: v } })} />
            ))}
            {e('consent.purposes.care_coordination') ? <Text accessibilityRole="alert" className="text-base text-danger-700">{e('consent.purposes.care_coordination')}</Text> : null}
            {e('consent.consentTextVersion') ? <Text accessibilityRole="alert" className="text-base text-danger-700">The consent wording version is not set yet. Ask your programme administrator, then sync.</Text> : null}
            <Choice label="How consent was given" value={d.consentMethod} onChange={(v) => update({ consentMethod: v })} options={[{ value: 'verbal', label: 'Verbal' }, { value: 'thumbprint', label: 'Thumbprint' }, { value: 'signature', label: 'Signature' }]} />
            <Field label="Witness (optional)" value={d.witnessName} onChangeText={(v) => update({ witnessName: v })} />
          </>
        )}
        {step === 5 && (
          <View className="gap-2">
            <Text className="text-lg font-semibold text-ink">{d.fullName || '—'}</Text>
            <Text className="text-base text-ink-muted">{d.sex === 'female' ? 'Female' : 'Male'} · {d.ageMode === 'dob' ? d.dateOfBirth : `about ${d.estimatedAge} years`}</Text>
            <Text className="text-base text-ink-muted">{CARE_PATHWAY_LABELS[d.carePathway]}</Text>
            <Text className="text-base text-ink-muted">{communities.find((c) => c.id === d.communityId)?.name ?? '—'}</Text>
            <Text className="text-base text-ink-muted">Consent: {CONSENT_PURPOSES.filter((p) => d.purposes[p]).length} of {CONSENT_PURPOSES.length}</Text>
          </View>
        )}
      </Card>

      <View className="flex-row gap-3">
        {step > 0 ? <View className="flex-1"><Button label={t('back')} variant="secondary" onPress={() => go(step - 1)} /></View> : null}
        <View className="flex-1">
          {step < STEPS.length - 1 ? <Button label={t('next')} onPress={() => go(step + 1)} /> : <Button label={t('save')} onPress={() => void save()} busy={busy} />}
        </View>
      </View>
    </Screen>
  );
}
