// The address bar is the navigation: #/ inbox, #/m/<account>/<message>, #/search, #/later, #/triage, #/compose, #/settings ...
// Notification taps arrive as #/m/<account id or email>/<message id>, so a tap lands straight on the message.

export type Route =
  | { name: 'inbox' }
  | { name: 'message'; account: string; id: string }
  | { name: 'search'; q: string }
  | { name: 'later' }
  | { name: 'triage' }
  | { name: 'compose'; mode: 'new' | 'reply' | 'replyAll' | 'forward'; account?: string; id?: string }
  | { name: 'accounts' }
  | { name: 'settings'; page: '' | 'alerts' | 'hours' | 'appearance'; account?: string };

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const [pathRaw, query = ''] = h.split('?');
  const parts = pathRaw.split('/').filter(Boolean).map(dec);
  const q = new URLSearchParams(query);
  switch (parts[0]) {
    case 'm': return parts[1] && parts[2] ? { name: 'message', account: parts[1], id: parts[2] } : { name: 'inbox' };
    case 'search': return { name: 'search', q: q.get('q') ?? '' };
    case 'later': return { name: 'later' };
    case 'triage': return { name: 'triage' };
    case 'accounts': return { name: 'accounts' };
    case 'compose': {
      const mode = (['reply', 'replyAll', 'forward'] as const).find((x) => x === parts[1]);
      return mode ? { name: 'compose', mode, ...(parts[2] ? { account: parts[2] } : {}), ...(parts[3] ? { id: parts[3] } : {}) } : { name: 'compose', mode: 'new' };
    }
    case 'settings': {
      const page = (['alerts', 'hours', 'appearance'] as const).find((x) => x === parts[1]) ?? '';
      return { name: 'settings', page, ...(parts[2] ? { account: parts[2] } : {}) };
    }
    default: return { name: 'inbox' };
  }
}

const enc = encodeURIComponent;
export function buildRoute(r: Route): string {
  switch (r.name) {
    case 'inbox': return '#/';
    case 'message': return `#/m/${enc(r.account)}/${enc(r.id)}`;
    case 'search': return r.q ? `#/search?q=${enc(r.q)}` : '#/search';
    case 'later': return '#/later';
    case 'triage': return '#/triage';
    case 'accounts': return '#/accounts';
    case 'compose': return r.mode === 'new' ? '#/compose' : `#/compose/${r.mode}/${enc(r.account ?? '')}/${enc(r.id ?? '')}`;
    case 'settings': return `#/settings${r.page ? `/${r.page}` : ''}${r.account ? `/${enc(r.account)}` : ''}`;
  }
}
