import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { importReport } from './api';
import { useI18n } from './i18n';
import { capture } from './outbox';
import { uuid } from './id';
import { findingToTodo, type ReportSummary } from '../shared/lib/report';
import { font, useTheme } from './theme';
import { Btn, Card, Check, Muted, styles } from './ui';

const nok = (n: number) => n.toLocaleString('nb-NO').replace(/ /g, ' ');

// Upload a tilstandsrapport (PDF). The AI lists the TG2/TG3 findings; you pick which become to-dos.
export function ReportImport({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const th = useTheme();
  const { t, tn } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<number | null>(null);
  const fail = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); setErr(m.startsWith('report:') ? t(`report.err.${m.slice(7)}` as 'report.err.failed') : m); };

  async function choose() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true); setErr(null);
    try {
      const r = await importReport(householdId, res.assets[0].uri);
      setReport(r);
      setPicked(new Set(r.findings.map((f, i) => [f, i] as const).filter(([f]) => f.tg !== 'TG2').map(([, i]) => i)));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function add() {
    if (!report) return;
    setBusy(true); setErr(null);
    try {
      const chosen = report.findings.filter((_, i) => picked.has(i));
      for (const f of chosen) await capture({ id: uuid(), household_id: householdId, body: findingToTodo(f, t), place_id: null, due_on: null, due_time: null, capture_lat: null, capture_lon: null, photoUris: [] });
      setDone(chosen.length);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <Card gap={12}>
      <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 18, fontFamily: font.semi }}>{t('report.title')}</Text>
      {done !== null ? (
        <>
          <Text style={{ color: th.ink, fontFamily: font.body, fontSize: 16 }}>{tn('report.added', done)}</Text>
          <Btn primary label={t('common.close')} onPress={onClose} />
        </>
      ) : !report ? (
        <>
          <Muted>{t('report.intro')}</Muted>
          <Btn primary disabled={busy} label={busy ? t('report.reading') : t('report.choose')} onPress={() => void choose()} />
          {err ? <Text style={{ color: th.danger ?? '#D6341F', fontFamily: font.body }}>{err}</Text> : null}
          <Btn disabled={busy} label={t('common.cancel')} onPress={onClose} />
        </>
      ) : (
        <>
          {report.summary ? <Text style={{ color: th.ink, fontFamily: font.body, fontSize: 15 }}>{report.summary}</Text> : null}
          {report.build_year ? <Muted>{t('report.built', { year: report.build_year })}</Muted> : null}
          {report.findings.length === 0 && <Muted>{t('report.none')}</Muted>}
          {report.findings.map((f, i) => (
            <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(i) }} onPress={() => toggle(i)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <Check small done={picked.has(i)} onPress={() => toggle(i)} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{f.title}</Text>
                <Muted>
                  {f.tg}{f.part ? ` · ${f.part}` : ''}{f.horizon !== 'unknown' ? ` · ${f.horizon === 'now' ? t('report.soon') : t('report.within', { h: f.horizon.replace(' years', '') })}` : ''}
                  {f.estimate_nok_max > 0 ? ` · ${nok(f.estimate_nok_min)}–${nok(f.estimate_nok_max)} kr` : ''}
                </Muted>
                {f.what ? <Text style={{ color: th.ink, fontFamily: font.body, fontSize: 14 }}>{f.what}</Text> : null}
              </View>
            </Pressable>
          ))}
          {err ? <Text style={{ color: th.danger ?? '#D6341F', fontFamily: font.body }}>{err}</Text> : null}
          <Btn primary disabled={busy || picked.size === 0} label={busy ? t('report.adding') : t('report.addSelected', { n: picked.size })} onPress={() => void add()} />
          <Btn disabled={busy} label={t('common.cancel')} onPress={onClose} />
        </>
      )}
    </Card>
  );
}
