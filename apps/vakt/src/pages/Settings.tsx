// Wages, supplements, shift types, goal and tax, and the account.
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, LogOut, Plus, Share, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { supabase } from '../data/config';
import { newId } from '../data/repo';
import { today } from '../lib/dates';
import { shiftKind } from '../lib/pay';
import { PRESETS, describeAmount, describeWhen } from '../lib/presets';
import type { Settings as SettingsT, ShiftTemplate, Supplement } from '../lib/types';
import { SupplementSheet } from '../components/SupplementSheet';
import { KindIcon } from '../components/ShiftSheet';
import { Button, Card, Chip, Label, NumberInput, Sheet, Switch, inputClass } from '../components/ui';

export function Settings() {
  const store = useStore();
  const { supplements, saveSupplement, email, local } = store;
  // Typing changes a draft; it is saved a moment after she stops, so every keystroke isn't a request.
  const [draft, setDraft] = useState<SettingsT>(store.settings);
  const saved = useRef(store.settings);
  useEffect(() => {
    if (draft === saved.current) return;
    const t = window.setTimeout(() => { saved.current = draft; void store.saveSettings(draft); }, 600);
    return () => window.clearTimeout(t);
  }, [draft, store]);
  const set = (patch: Partial<SettingsT>) => setDraft((d) => ({ ...d, ...patch }));

  const [editing, setEditing] = useState<Supplement | 'new' | null>(null);
  const [template, setTemplate] = useState<ShiftTemplate | 'new' | null>(null);
  const wages = [...draft.wages].sort((a, b) => b.from.localeCompare(a.from));
  const missing = PRESETS.filter((p) => !supplements.some((s) => s.name.toLowerCase() === p.name.toLowerCase()));
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches;

  return (
    <div className="space-y-6">
      <Section title="Timelønn" hint="Ved lønnsøkning legger du til en ny fra datoen den gjelder fra – tidligere vakter beholder den gamle.">
        <Card className="space-y-3">
          {wages.length === 0 && <p className="text-[14px] text-ink-3">Ingen timelønn lagt inn ennå.</p>}
          {wages.map((w) => {
            const i = draft.wages.indexOf(w);
            const update = (patch: Partial<typeof w>) => set({ wages: draft.wages.map((x, j) => j === i ? { ...x, ...patch } : x) });
            return (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Kroner per time</Label>
                  <NumberInput ariaLabel="Timelønn" value={w.hourly || null} onChange={(n) => update({ hourly: n ?? 0 })} suffix="kr/t" />
                </div>
                <div className="flex-1">
                  <Label>Gjelder fra</Label>
                  <input type="date" aria-label="Gjelder fra" className={inputClass} value={w.from} onChange={(e) => e.target.value && update({ from: e.target.value })} />
                </div>
                {draft.wages.length > 1 && (
                  <button aria-label="Fjern timelønn" className="mb-1 grid size-11 place-items-center rounded-full text-ink-3" onClick={() => set({ wages: draft.wages.filter((_, j) => j !== i) })}><Trash2 className="size-4.5" /></button>
                )}
              </div>
            );
          })}
          <button className="flex items-center gap-1.5 text-[14px] font-semibold text-accent-ink"
            onClick={() => set({ wages: [...draft.wages, { from: today(), hourly: wages[0]?.hourly ?? 0 }] })}>
            <Plus className="size-4" /> {draft.wages.length ? 'Ny timelønn (lønnsøkning)' : 'Legg inn timelønn'}
          </button>
        </Card>
      </Section>

      <Section title="Tillegg" hint="Regnes automatisk på hver vakt ut fra dag og klokkeslett.">
        <div className="space-y-2">
          {supplements.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-card">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setEditing(s)}>
                <span className="size-3.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{s.name} <span className="font-medium text-ink-3">· {describeAmount(s)}</span></span>
                  <span className="block truncate text-[13px] text-ink-3">{describeWhen(s)}</span>
                </span>
              </button>
              <Switch label={`${s.name} i bruk`} on={s.active} onChange={(v) => void saveSupplement({ ...s, active: v })} />
            </div>
          ))}
          <Button variant="soft" className="w-full" onClick={() => setEditing('new')}><Plus className="size-5" /> Legg til tillegg</Button>
          {missing.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 text-[13px] text-ink-3">Vanlige tillegg (sjekk beløpet mot lønnsslippen):</p>
              <div className="flex flex-wrap gap-2">
                {missing.map((p) => (
                  <Chip key={p.name} onClick={() => {
                    const { hint: _hint, ...rest } = p;
                    setEditing({ ...rest, id: newId(), active: true, sort: supplements.length });
                  }}>+ {p.name}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Vakttyper" hint="Snarveier når du legger inn en vakt.">
        <div className="space-y-2">
          {draft.templates.map((t) => (
            <button key={t.id} onClick={() => setTemplate(t)} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left shadow-card">
              <KindIcon kind={shiftKind(t)} className="size-5 text-ink-3" />
              <span className="flex-1 text-[15px] font-semibold">{t.name}</span>
              <span className="tabular text-[14px] text-ink-3">{t.start_time}–{t.end_time}{t.break_minutes ? ` · ${t.break_minutes} min pause` : ''}</span>
              <ChevronRight className="size-4 text-ink-3" />
            </button>
          ))}
          {draft.templates.length < 6 && <Button variant="soft" className="w-full" onClick={() => setTemplate('new')}><Plus className="size-5" /> Ny vakttype</Button>}
        </div>
      </Section>

      <Section title="Mål og skatt">
        <Card className="space-y-4">
          <div>
            <Label hint="før skatt">Månedsmål</Label>
            <NumberInput ariaLabel="Månedsmål" value={draft.goal} onChange={(n) => set({ goal: n && n > 0 ? n : null })} suffix="kr" placeholder="F.eks. 35 000" />
          </div>
          <div>
            <Label hint="står på skattekortet">Skattetrekk</Label>
            <NumberInput ariaLabel="Skattetrekk" value={draft.tax_percent} onChange={(n) => set({ tax_percent: n && n > 0 && n < 100 ? n : null })} suffix="%" placeholder="F.eks. 30" />
          </div>
          <div>
            <Label>Navnet ditt</Label>
            <input className={inputClass} aria-label="Navnet ditt" value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
          </div>
        </Card>
      </Section>

      {!standalone && (
        <Section title="Legg appen på Hjem-skjermen">
          <Card className="text-[14.5px] leading-relaxed text-ink-2">
            {isIos
              ? <>Trykk på <Share className="inline size-4 align-[-2px]" /> <strong>Del</strong> nederst i Safari, og velg <strong>Legg til på Hjem-skjerm</strong>. Da åpner Vakt seg som en egen app.</>
              : <>Åpne nettlesermenyen og velg <strong>Installer app</strong> eller <strong>Legg til på startskjermen</strong>.</>}
          </Card>
        </Section>
      )}

      <Section title="Konto">
        <Card className="space-y-3">
          {local
            ? <p className="text-[14px] text-ink-2">Prøvemodus: dataene ligger bare i denne nettleseren.</p>
            : <p className="text-[14px] text-ink-2">Logget inn som <strong>{email}</strong>. Alt lagres trygt i skyen.</p>}
          {!local && (
            <Button variant="soft" className="w-full" onClick={() => void supabase().auth.signOut().then(() => location.reload())}><LogOut className="size-5" /> Logg ut</Button>
          )}
        </Card>
      </Section>

      {editing && <SupplementSheet supplement={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {template && (
        <TemplateSheet
          template={template === 'new' ? undefined : template}
          onSave={(t) => set({ templates: draft.templates.some((x) => x.id === t.id) ? draft.templates.map((x) => x.id === t.id ? t : x) : [...draft.templates, t] })}
          onDelete={(id) => set({ templates: draft.templates.filter((x) => x.id !== id) })}
          onClose={() => setTemplate(null)}
        />
      )}
      <p className="pb-4 text-center text-[12px] text-ink-3">Vakt regner ut brutto lønn fra det du legger inn. Sjekk gjerne mot lønnsslippen.</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-1 text-[18px] font-bold">{title}</h2>
      {hint && <p className="mb-3 px-1 text-[13px] text-ink-3">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function TemplateSheet({ template, onSave, onDelete, onClose }: { template?: ShiftTemplate; onSave: (t: ShiftTemplate) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [t, setT] = useState<ShiftTemplate>(template ?? { id: newId(), name: '', start_time: '07:30', end_time: '15:30', break_minutes: 0 });
  const valid = t.name.trim() && t.start_time !== t.end_time;
  return (
    <Sheet title={template ? 'Endre vakttype' : 'Ny vakttype'} onClose={onClose} footer={
      <div className="flex gap-2">
        {template && <Button variant="danger" aria-label="Slett vakttype" className="px-4" onClick={() => { onDelete(t.id); onClose(); }}><Trash2 className="size-5" /></Button>}
        <Button variant="primary" className="flex-1" disabled={!valid} onClick={() => { onSave({ ...t, name: t.name.trim() }); onClose(); }}>Lagre</Button>
      </div>
    }>
      <div className="mb-4"><Label>Navn</Label><input className={inputClass} aria-label="Navn" placeholder="F.eks. Langvakt" maxLength={20} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div><Label>Fra</Label><input type="time" aria-label="Fra" className={inputClass} value={t.start_time} onChange={(e) => e.target.value && setT({ ...t, start_time: e.target.value })} /></div>
        <div><Label>Til</Label><input type="time" aria-label="Til" className={inputClass} value={t.end_time} onChange={(e) => e.target.value && setT({ ...t, end_time: e.target.value })} /></div>
      </div>
      <Label>Ubetalt pause</Label>
      <div className="flex flex-wrap gap-2">
        {[0, 15, 30, 45, 60].map((b) => <Chip key={b} active={t.break_minutes === b} onClick={() => setT({ ...t, break_minutes: b })}>{b === 0 ? 'Ingen' : `${b} min`}</Chip>)}
      </div>
    </Sheet>
  );
}
