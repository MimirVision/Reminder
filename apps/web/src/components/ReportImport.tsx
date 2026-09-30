import { useState } from 'react';
import { addMemory, importReport } from '../lib/api';
import { findingToTodo, type Finding, type ReportSummary } from '../lib/report';
import type { Household } from '../lib/types';

const nok = (n: number) => n.toLocaleString('nb-NO').replace(/\u00a0/g, ' ');

// Upload a tilstandsrapport (PDF). The AI lists the TG2/TG3 findings; you pick which become to-dos.
export function ReportImport({ household, onClose, onAdded }: { household: Household; onClose: () => void; onAdded: () => void }) {
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!report) return;
    setBusy(true); setErr(null);
    try {
      const chosen = report.findings.filter((_, i) => picked.has(i));
      for (const f of chosen) await addMemory({ household_id: household.id, body: findingToTodo(f) });
      setDone(chosen.length);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="card">
      <h2>Import a tilstandsrapport</h2>
      {done !== null ? (
        <>
          <p>Added {done} to-do{done === 1 ? '' : 's'}. You will find them under To-do, Anytime.</p>
          <button className="btn primary" onClick={onClose}>Close</button>
        </>
      ) : !report ? (
        <>
          <span className="muted">
            Upload the PDF and the findings graded TG3, TG2 and TGIU are listed with the recommended measure and cost estimate.
            The PDF is stored privately in your household and sent to Anthropic's API to be read.
          </span>
          <label className={`btn primary${busy ? ' disabled' : ''}`} style={{ textAlign: 'center' }}>
            {busy ? 'Reading the report… this can take a minute or two' : 'Choose PDF'}
            <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {err && <p className="error">{err}</p>}
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      ) : (
        <>
          {report.summary && <p style={{ margin: 0 }}>{report.summary}</p>}
          {report.build_year && <span className="muted">Built {report.build_year}</span>}
          {report.findings.length === 0 && <p className="muted">No TG2, TG3 or TGIU findings were found.</p>}
          {report.findings.map((f: Finding, i) => (
            <label key={i} className="list-row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 22, height: 22, marginTop: 2 }} checked={picked.has(i)} onChange={() => toggle(i)} />
              <span style={{ flex: 1 }}>
                <strong>{f.title}</strong>
                <span className="muted" style={{ display: 'block' }}>
                  {f.tg}{f.part ? ` · ${f.part}` : ''}{f.horizon !== 'unknown' ? ` · ${f.horizon}` : ''}
                  {f.estimate_nok_max > 0 ? ` · ${nok(f.estimate_nok_min)}–${nok(f.estimate_nok_max)} kr` : ''}
                </span>
                {f.what && <span style={{ display: 'block', fontSize: 14 }}>{f.what}</span>}
              </span>
            </label>
          ))}
          {err && <p className="error">{err}</p>}
          <button className="btn primary" onClick={() => void add()} disabled={busy || picked.size === 0}>
            {busy ? 'Adding…' : `Add ${picked.size} selected as to-dos`}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      )}
    </div>
  );
}
