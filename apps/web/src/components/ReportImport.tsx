import { useState } from 'react';
import { addMemory, importReport } from '../lib/api';
import { findingToTodo, type Finding, type ReportSummary } from '../lib/report';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';

const nok = (n: number) => n.toLocaleString('nb-NO').replace(/\u00a0/g, ' ');
const reportError = (e: unknown, t: ReturnType<typeof useI18n>['t']) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('report:') ? t(`report.err.${m.slice(7)}` as 'report.err.failed') : m;
};

// Upload a tilstandsrapport (PDF). The AI lists the TG2/TG3 findings; you pick which become to-dos.
export function ReportImport({ household, onClose, onAdded }: { household: Household; onClose: () => void; onAdded: () => void }) {
  const { t, tn } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<number | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await importReport(household.id, file);
      setReport(r);
      setPicked(new Set(r.findings.map((f, i) => [f, i] as const).filter(([f]) => f.tg !== 'TG2').map(([, i]) => i)));
    } catch (e) {
      setErr(reportError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!report) return;
    setBusy(true); setErr(null);
    try {
      const chosen = report.findings.filter((_, i) => picked.has(i));
      for (const f of chosen) await addMemory({ household_id: household.id, body: findingToTodo(f, t) });
      setDone(chosen.length);
      onAdded();
    } catch (e) {
      setErr(reportError(e, t));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="card">
      <h2>{t('report.title')}</h2>
      {done !== null ? (
        <>
          <p>{tn('report.added', done)}</p>
          <button className="btn primary" onClick={onClose}>{t('common.close')}</button>
        </>
      ) : !report ? (
        <>
          <span className="muted">{t('report.intro')}</span>
          <label className={`btn primary${busy ? ' disabled' : ''}`} style={{ textAlign: 'center' }}>
            {busy ? t('report.reading') : t('report.choose')}
            <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {err && <p className="error">{err}</p>}
          <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        </>
      ) : (
        <>
          {report.summary && <p style={{ margin: 0 }}>{report.summary}</p>}
          {report.build_year && <span className="muted">{t('report.built', { year: report.build_year })}</span>}
          {report.findings.length === 0 && <p className="muted">{t('report.none')}</p>}
          {report.findings.map((f: Finding, i) => (
            <label key={i} className="list-row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 22, height: 22, marginTop: 2 }} checked={picked.has(i)} onChange={() => toggle(i)} />
              <span style={{ flex: 1 }}>
                <strong>{f.title}</strong>
                <span className="muted" style={{ display: 'block' }}>
                  {f.tg}{f.part ? ` · ${f.part}` : ''}{f.horizon !== 'unknown' ? ` · ${f.horizon === 'now' ? t('report.soon') : t('report.within', { h: f.horizon.replace(' years', '') })}` : ''}
                  {f.estimate_nok_max > 0 ? ` · ${nok(f.estimate_nok_min)}–${nok(f.estimate_nok_max)} kr` : ''}
                </span>
                {f.what && <span style={{ display: 'block', fontSize: 14 }}>{f.what}</span>}
              </span>
            </label>
          ))}
          {err && <p className="error">{err}</p>}
          <button className="btn primary" onClick={() => void add()} disabled={busy || picked.size === 0}>
            {busy ? t('report.adding') : t('report.addSelected', { n: picked.size })}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        </>
      )}
    </div>
  );
}
