import { useCallback, useEffect, useState } from 'react';
import { createFeedKey, deleteFeedKey, listFeedKeys, listPlaces, type FeedKey } from '../lib/api';
import { placeLabel } from '../lib/labels';
import { buildLinks } from '../lib/reminderLinks';
import type { Household, Place } from '../lib/types';
import { useI18n } from '../i18n';

const storeKey = (householdId: string) => `hm.reminderKey.${householdId}`;
const readKey = (householdId: string) => { try { return localStorage.getItem(storeKey(householdId)); } catch { return null; } };

function CopyRow({ label, url, note }: { label: string; url: string; note?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyrow">
      <div className="copytext">
        <strong>{label}</strong>
        {note && <div className="muted">{note}</div>}
        <code className="clip">{url}</code>
      </div>
      <button className="btn small" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt(t('rem.copyPrompt'), url); }
      }}>{copied ? t('common.copied') : t('common.copy')}</button>
    </div>
  );
}

// Reminders that need no native app: iPhone Shortcuts automations (arrive at a place, every morning or Sunday) and a Calendar feed.
export function ReminderLinks({ household }: { household: Household }) {
  const { t, lang, locale } = useI18n();
  const [keys, setKeys] = useState<FeedKey[]>([]);
  const [key, setKey] = useState<string | null>(() => readKey(household.id));
  const [places, setPlaces] = useState<Place[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await listFeedKeys());
      setPlaces(await listPlaces(household.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    try {
      setErr(null);
      const k = await createFeedKey(household.id, 'iPhone');
      try { localStorage.setItem(storeKey(household.id), k); } catch { /* the links can still be copied now */ }
      setKey(k);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function revoke(id: string) {
    if (!confirm(t('rem.revokeConfirm'))) return;
    try {
      await deleteFeedKey(id);
      try { localStorage.removeItem(storeKey(household.id)); } catch { /* ignore */ }
      setKey(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const links = key ? buildLinks(window.location.origin, key, places.map((p) => (p.kind === 'category' ? { ...p, name: placeLabel(p, t) } : p)), lang) : null;

  return (
    <section className="card">
      <h2>{t('rem.title')}</h2>
      <span className="muted">{t('rem.intro')}</span>
      {err && <p className="error">{err}</p>}

      {links ? (
        <>
          <CopyRow label={t('rem.today')} url={links.today} note={t('rem.todayNote')} />
          <CopyRow label={t('rem.digest')} url={links.digest} note={t('rem.digestNote')} />
          {links.places.length === 0 && <span className="muted">{t('rem.noPlaces')}</span>}
          {links.places.map((p) => <CopyRow key={p.url} label={t('rem.arrive', { place: p.label })} url={p.url} note={t('rem.arriveNote')} />)}
          <CopyRow label={t('rem.calendar')} url={links.calendar} note={t('rem.calendarNote')} />
          <div className="row">
            <a className="btn small" href={links.calendar}>{t('rem.subscribe')}</a>
            <a className="btn small" href={links.digest} target="_blank" rel="noreferrer">{t('rem.preview')}</a>
          </div>
        </>
      ) : keys.length > 0 ? (
        <span className="muted">{t('rem.keyExists')}</span>
      ) : (
        <button className="btn primary" onClick={() => void create()}>{t('rem.create')}</button>
      )}

      {keys.map((k) => (
        <div key={k.id} className="row spread">
          <span>{k.label}<span className="muted"> · {k.last_used_at ? t('rem.lastUsed', { date: new Date(k.last_used_at).toLocaleDateString(locale) }) : t('rem.notUsed')}</span></span>
          <button className="btn small danger" onClick={() => void revoke(k.id)}>{t('common.revoke')}</button>
        </div>
      ))}
      <span className="muted">{t('rem.warning')}</span>
    </section>
  );
}
