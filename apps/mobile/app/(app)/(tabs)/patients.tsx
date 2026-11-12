import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { CARE_PATHWAY_LABELS, type PatientDto } from '@caretrail/shared-types';
import { Badge, Button, Empty, Field, ListRow, Screen, Title } from '@/components/ui';
import { isLocal, listPatients } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function Patients() {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const patients = useLocalQuery(() => listPatients(q), [q]).data ?? [];

  return (
    <Screen scroll={false}>
      <Title>{t('patients')}</Title>
      <Field label={t('search')} value={q} onChangeText={setQ} autoCorrect={false} />
      <Button label={t('registerPatient')} onPress={() => router.push('/register')} />
      <View className="flex-1 overflow-hidden rounded-xl border border-border">
        <FlatList<PatientDto>
          data={patients}
          keyExtractor={(p) => p.id}
          initialNumToRender={15}
          windowSize={7}
          ListEmptyComponent={<Empty text={t('noPatients')} />}
          renderItem={({ item }) => (
            <ListRow
              title={item.fullName}
              subtitle={`${isLocal(item.id) ? t('pendingId') : item.patientCode} · ${CARE_PATHWAY_LABELS[item.carePathway]}`}
              right={isLocal(item.id) ? <Badge label={t('pendingSync')} tone="warn" /> : null}
              onPress={() => router.push({ pathname: '/patient/[id]', params: { id: item.id } })}
            />
          )}
        />
      </View>
    </Screen>
  );
}
