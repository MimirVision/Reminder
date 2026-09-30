import { useCallback, useEffect, useState } from 'react';
import { createFeedKey, deleteFeedKey, listFeedKeys, listPlaces, type FeedKey } from '../lib/api';
import { buildLinks } from '../lib/reminderLinks';
import type { Household, Place } from '../lib/types';

const storeKey = (householdId: string) => `hm.reminderKey.${householdId}`;
const readKey = (householdId: string) => { try { return localStorage.getItem(storeKey(householdId)); } catch { return null; } };

function CopyRow({ label, url, note }: { label: string; url: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyrow">
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>{label}</strong>
        {note && <div className="muted">{note}</div>}
        <code className="clip">{url}</code>
      </div>
      <button className="btn small" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt('Copy this link:', url); }
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

// Reminders that need no native app: iPhone Shortcuts automations (arrive at a place, every Sunday) and a Calendar feed.
export function ReminderLinks({ household }: { household: Household }) {
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
    if (!confirm('Revoke this key? Every Shortcut and calendar using its links stops working.')) return;
    try {
      await deleteFeedKey(id);
      try { localStorage.removeItem(storeKey(household.id)); } catch { /* ignore */ }
      setKey(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const links = key ? buildLinks(window.location.origin, key, places) : null;

  return (
    <section className="card">
      <h2>iPhone reminders (no app needed)</h2>
      <span className="muted">
        Your iPhone can tap you on the shoulder using its own Shortcuts and Calendar apps: a notification when you arrive at a
        place, a Sunday summary, and your house tasks in the calendar. Step by step: <code>docs/REMINDERS.md</code>.
      </span>
      {err && <p className="error">{err}</p>}

      {links ? (
        <>
          <CopyRow label="Sunday summary" url={links.digest} note="For a Shortcuts automation: Time of Day, weekly." />
          {links.places.length === 0 && <span className="muted">Add places under Places to get an "arrive at" link for each.</span>}
          {links.places.map((p) => <CopyRow key={p.url} label={`When I arrive: ${p.label}`} url={p.url} note="For a Shortcuts automation: Arrive." />)}
          <CopyRow label="House tasks calendar" url={links.calendar} note="Open this link on the iPhone to subscribe in Calendar." />
          <div className="row">
            <a className="btn small" href={links.calendar}>Subscribe in Calendar</a>
            <a className="btn small" href={links.digest} target="_blank" rel="noreferrer">Preview the summary</a>
          </div>
        </>
      ) : keys.length > 0 ? (
        <span className="muted">A key exists but its links are only shown on the device that made it. Revoke it and make a new one here.</span>
      ) : (
        <button className="btn primary" onClick={() => void create()}>Create reminder key</button>
      )}

      {keys.map((k) => (
        <div key={k.id} className="row spread">
          <span>{k.label}<span className="muted"> · {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'not used yet'}</span></span>
          <button className="btn small danger" onClick={() => void revoke(k.id)}>Revoke</button>
        </div>
      ))}
      <span className="muted">Anyone with these links can read your to-dos and house tasks (not change them). Revoke the key if a link leaks.</span>
    </section>
  );
}
