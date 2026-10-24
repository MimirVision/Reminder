import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listConditionItems, seedConditionItems, updateConditionItem } from './api';
import { Chip } from './Chip';
import { uuid } from './id';
import { useI18n } from './i18n';
import { capture, pending } from './outbox';
import { useSession } from './session';
import { useToast } from './Toast';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted, SectionLabel, styles } from './ui';
import {
  TG_ORDER, WHEN_ORDER, costLabel, defaultFilter, filterItems, groupByArea, nok, summarize, todoFromItem, todoPriority,
  type ConditionFilter, type ConditionItem, type Tg,
} from '../shared/lib/condition';
import { CONDITION_SEED, CONDITION_SOURCE } from '../shared/lib/conditionSeed';

const TG_COLOR: Record<Tg, string> = { TG3: '#C62D1A', TG2: '#B45309', HMS: '#7C3AED', LOV: '#2563EB' };

// House > Report: the findings of the condition report (TG3, TG2, safety and legality notes), kept apart from the to-do list.
export function ConditionView() {
  const th = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { household } = useSession();
  const [items, setItems] = useState<ConditionItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConditionFilter>(defaultFilter);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const missing = (m: string) => (/condition_items|schema cache|does not exist/i.test(m) ? t('cond.noTable') : m);

  const load = useCallback(async () => {
    if (!household) return;
    try { setItems(await listConditionItems(household.id)); setErr(null); }
    catch (e) { setErr(missing(e instanceof Error ? e.message : String(e))); setItems([]); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarize(items ?? []), [items]);
  const groups = useMemo(() => groupByArea(filterItems(items ?? [], filter)), [items, filter]);

  async function loadReport() {
    if (!household) return;
    setBusy(true);
    try { await seedConditionItems(household.id, CONDITION_SEED, CONDITION_SOURCE); await load(); toast({ text: t('cond.loaded', { n: CONDITION_SEED.length }) }); }
    catch (e) { setErr(missing(e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  }

  const patch = async (i: ConditionItem, p: Parameters<typeof updateConditionItem>[1]) => {
    setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? { ...x, ...p, ...(p.status ? { done_at: p.status === 'done' ? new Date().toISOString() : null } : {}) } : x)));
    try { await updateConditionItem(i.id, p); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await load(); }
  };

  async function toTodo(i: ConditionItem) {
    if (!household) return;
    const d = todoFromItem(i);
    const id = uuid();
    await capture({ id, household_id: household.id, body: d.body, place_id: null, due_on: null, due_time: null, notes: d.notes, tags: d.tags, priority: todoPriority(i), capture_lat: null, capture_lon: null, photoUris: [] });
    if (!pending().some((p) => p.id === id)) await patch(i, { memory_id: id }); // linked once it has reached the server
    toast({ text: t('cond.addedTodo') });
  }

  if (items === null) return <Muted>{t('common.loading')}</Muted>;

  if (items.length === 0) {
    return (
      <Card gap={12}>
        <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 20, fontFamily: font.semi }}>{t('cond.title')}</Text>
        <Muted>{t('cond.intro')}</Muted>
        {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
        <Btn primary disabled={busy} label={t('cond.load')} onPress={() => void loadReport()} />
        <Muted>{t('cond.loadHelp')}</Muted>
      </Card>
    );
  }

  const pct = summary.total ? summary.done / summary.total : 0;
  const tgs = TG_ORDER.filter((g) => summary.byTg[g].total > 0);

  return (
    <View style={{ gap: 12 }}>
      <Card gap={10}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('cond.title')}</Text>
          <Muted>{t('cond.openOf', { open: summary.open, total: summary.total })}</Muted>
        </View>
        <View accessibilityRole="progressbar" style={{ height: 8, borderRadius: 4, backgroundColor: th.dark ? '#262C36' : '#ECEEF2', overflow: 'hidden' }}>
          <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: th.accent }} />
        </View>
        <View style={styles.row}>
          {tgs.map((g) => (
            <Pressable key={g} accessibilityRole="button" accessibilityState={{ selected: filter.tg === g }} onPress={() => setFilter({ ...filter, tg: filter.tg === g ? 'all' : g })}
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, borderRadius: 14, borderWidth: filter.tg === g ? 2 : 1, borderColor: filter.tg === g ? th.ink : th.line, paddingVertical: 6, paddingHorizontal: 12 }}>
              <Text style={{ color: TG_COLOR[g], fontSize: 22, fontFamily: font.semi }}>{summary.byTg[g].open}</Text>
              <Text style={{ color: th.muted, fontSize: 13, fontFamily: font.semi }}>{t(`cond.tg.${g}` as 'cond.tg.TG3')}</Text>
            </Pressable>
          ))}
        </View>
        {summary.costOpen.max > 0 && <Muted>{t('cond.estimate')}: {nok(summary.costOpen.min)}–{nok(summary.costOpen.max)} kr</Muted>}
      </Card>

      <View style={styles.row}>
        <Chip label={t('cond.all')} on={filter.tg === 'all'} onPress={() => setFilter({ ...filter, tg: 'all' })} />
        {tgs.map((g) => <Chip key={g} label={t(`cond.tg.${g}` as 'cond.tg.TG3')} on={filter.tg === g} onPress={() => setFilter({ ...filter, tg: g })} />)}
      </View>
      <View style={styles.row}>
        <Chip label={t('cond.when.all')} on={filter.when === 'all'} onPress={() => setFilter({ ...filter, when: 'all' })} />
        {WHEN_ORDER.map((w) => <Chip key={w} label={t(`cond.when.${w}` as 'cond.when.now')} on={filter.when === w} onPress={() => setFilter({ ...filter, when: w })} />)}
        <Chip label={filter.showDone ? t('cond.hideDone') : t('cond.showDone')} on={filter.showDone} onPress={() => setFilter({ ...filter, showDone: !filter.showDone })} />
      </View>
      {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
      {groups.length === 0 && <Muted>{t('cond.empty')}</Muted>}

      {groups.map((g) => (
        <View key={g.area} style={{ gap: 8 }}>
          <SectionLabel>{t(`cond.area.${g.area}` as 'cond.area.other')}</SectionLabel>
          {g.items.map((i) => {
            const cost = costLabel(i.cost_min, i.cost_max);
            return (
              <View key={i.id} style={{ backgroundColor: th.card, borderRadius: 18, padding: 14, gap: 8, borderLeftWidth: 4, borderLeftColor: TG_COLOR[i.tg], opacity: i.status === 'open' ? 1 : 0.62 }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ backgroundColor: TG_COLOR[i.tg], borderRadius: 8, paddingHorizontal: 9, paddingVertical: 2, marginTop: 2 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: font.semi }}>{t(`cond.tg.${i.tg}` as 'cond.tg.TG3')}</Text>
                  </View>
                  <Text style={{ flex: 1, color: th.ink, fontSize: 17, lineHeight: 23, fontFamily: font.semi }}>{i.part}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={{ color: i.when_kind === 'now' ? '#B42318' : th.muted, fontSize: 13, fontFamily: font.semi }}>{t(`cond.when.${i.when_kind}` as 'cond.when.now')}</Text>
                  {cost ? <Text style={{ color: th.muted, fontSize: 13, fontFamily: font.body }}>· {t('cond.cost')}: {cost}</Text> : null}
                  {i.page ? <Text style={{ color: th.muted, fontSize: 13, fontFamily: font.body }}>· {t('cond.page', { p: i.page })}</Text> : null}
                  {i.status !== 'open' ? <Text style={{ color: th.ink, fontSize: 13, fontFamily: font.semi }}>· {t(`cond.status.${i.status}` as 'cond.status.done')}</Text> : null}
                  {i.memory_id ? <Text style={{ color: th.muted, fontSize: 13, fontFamily: font.body }}>· {t('cond.inTodos')}</Text> : null}
                </View>
                <Text style={{ color: th.ink, fontSize: 15, lineHeight: 21, fontFamily: font.body }}><Text style={{ color: th.muted }}>{t('cond.finding')}: </Text>{i.what}</Text>
                <Text style={{ color: th.ink, fontSize: 15, lineHeight: 21, fontFamily: font.body }}><Text style={{ fontFamily: font.semi }}>{t('cond.advice')}: </Text>{i.action}</Text>
                {i.notes && noteOpen !== i.id ? <Muted>{i.notes}</Muted> : null}
                {noteOpen === i.id && (
                  <View style={{ gap: 8 }}>
                    <Field multiline placeholder={t('cond.notePh')} value={draft} onChangeText={setDraft} style={{ minHeight: 64 }} />
                    <Btn small primary label={t('common.save')} onPress={() => { const v = draft.trim(); setNoteOpen(null); void patch(i, { notes: v || null }); }} />
                  </View>
                )}
                <View style={styles.row}>
                  {i.status === 'open' ? <Btn small primary label={t('cond.done')} onPress={() => void patch(i, { status: 'done' })} /> : <Btn small label={t('cond.reopen')} onPress={() => void patch(i, { status: 'open' })} />}
                  {!i.memory_id && i.status === 'open' ? <Btn small label={t('cond.toTodo')} onPress={() => void toTodo(i)} /> : null}
                  {i.status === 'open' ? <Btn small label={t('cond.skip')} onPress={() => void patch(i, { status: 'skipped' })} /> : null}
                  <Btn small label={t('cond.note')} onPress={() => { setDraft(i.notes ?? ''); setNoteOpen(noteOpen === i.id ? null : i.id); }} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
      <Muted>{t('cond.disclaimer')}</Muted>
    </View>
  );
}
