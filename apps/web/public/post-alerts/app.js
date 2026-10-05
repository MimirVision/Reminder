// Post alerts page: connects this Home Screen web app to your Post alert server and shows what is being watched.
// Everything is stored on this phone only (localStorage). The setup link from the Post app can prefill it: ...#s=<base64 of url|key>.
(() => {
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const lang = (navigator.language || 'en').startsWith('nb') || (navigator.language || '').startsWith('no') ? 'nb' : 'en';

  const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const bytesToB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Prefill from a setup link, then remove it from the address bar.
  const m = /[#&]s=([^&]+)/.exec(location.hash);
  if (m) {
    try { const [u, k] = atob(decodeURIComponent(m[1])).split('|'); if (u) store.set('url', u); if (k) store.set('key', k); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
  }

  async function call(body) {
    const res = await fetch(store.get('url'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-alerts-key': store.get('key') }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'The alerts key was not accepted.' : res.status === 503 ? 'The server is not set up yet (missing secrets).' : json.error || `Error ${res.status}`);
    return json;
  }

  const ago = (iso) => {
    if (!iso) return 'no alerts yet';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return min < 1 ? 'last alert just now' : min < 60 ? `last alert ${min} min ago` : min < 1440 ? `last alert ${Math.round(min / 60)} h ago` : `last alert ${Math.round(min / 1440)} d ago`;
  };

  async function showStatus() {
    $('setup').hidden = true; $('status').hidden = false;
    const s = await call({ op: 'status' });
    const list = $('accounts'); list.textContent = '';
    if (!s.accounts.length) { const d = document.createElement('p'); d.textContent = 'No mailbox is being watched yet. Turn on alerts for an account inside the Post app.'; list.append(d); }
    for (const a of s.accounts) {
      const hoursLeft = a.subscription_expires_at ? (new Date(a.subscription_expires_at).getTime() - Date.now()) / 3600000 : -1;
      const row = document.createElement('div'); row.className = 'row' + (hoursLeft < 0 ? ' bad' : '');
      row.innerHTML = '<span class="dot"></span><span><b></b><small></small></span>';
      row.querySelector('b').textContent = a.label ? `${a.label} (${a.email})` : a.email;
      row.querySelector('small').textContent = `${a.mode === 'people' ? 'people only' : a.mode === 'all' ? 'all mail' : a.mode === 'vips' ? 'VIPs only' : 'off'} · ${hoursLeft < 0 ? 'not watching, open Post to sign in again' : ago(a.last_alert_at)}`;
      list.append(row);
    }
  }

  async function connect() {
    const msg = $('msg'); msg.className = 'msg'; msg.textContent = '';
    try {
      store.set('url', $('url').value.trim()); store.set('key', $('key').value.trim());
      if (!/^https:\/\//.test(store.get('url')) || !store.get('key')) throw new Error('Fill in both fields.');
      $('connect').disabled = true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This phone cannot receive web alerts. Needs iOS 16.4 or newer and the Home Screen icon.');
      const { publicKey } = await call({ op: 'vapid' });
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications were not allowed. Turn them on in iOS Settings, Notifications, Post alerts.');
      const reg = await navigator.serviceWorker.register('/post-alerts/sw.js', { scope: '/post-alerts/' });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
      await call({ op: 'pair', endpoint: sub.endpoint, p256dh: bytesToB64u(sub.getKey('p256dh')), auth: bytesToB64u(sub.getKey('auth')), lang });
      store.set('paired', '1');
      await showStatus();
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = e.message || String(e);
    } finally { $('connect').disabled = false; }
  }

  // Opening the page counts as "I have looked": clear the icon number here and on the server.
  async function markSeen() {
    try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch {}
    try {
      const reg = await navigator.serviceWorker.getRegistration('/post-alerts/');
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub && store.get('url') && store.get('key')) await call({ op: 'seen', endpoint: sub.endpoint });
    } catch {}
  }

  async function init() {
    const open = new URLSearchParams(location.search).get('open');
    if (open) {
      $('open').hidden = false;
      const target = `postmail://message?id=${encodeURIComponent(open)}&acct=${encodeURIComponent(new URLSearchParams(location.search).get('acct') || '')}`;
      $('openLink').href = target;
    }
    if (!standalone) { $('install').hidden = false; }
    $('url').value = store.get('url'); $('key').value = store.get('key');
    if (store.get('paired') && store.get('url') && store.get('key')) { markSeen(); try { await showStatus(); return; } catch (e) { /* fall through to setup */ } }
    if (standalone || location.hostname === 'localhost') $('setup').hidden = false;
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.get('paired')) markSeen(); });
  $('connect').addEventListener('click', connect);
  $('refresh').addEventListener('click', () => showStatus().catch((e) => { $('msg2').className = 'msg err'; $('msg2').textContent = e.message; }));
  $('test').addEventListener('click', async () => {
    const out = $('msg2'); out.className = 'msg'; out.textContent = 'Sending…';
    try { const r = await call({ op: 'test' }); out.className = 'msg ok'; out.textContent = r.sent ? 'Sent. It should appear in a few seconds. Lock the phone to see it as a real alert.' : 'No phone is registered yet.'; }
    catch (e) { out.className = 'msg err'; out.textContent = e.message; }
  });
  $('off').addEventListener('click', async () => {
    try { const reg = await navigator.serviceWorker.getRegistration('/post-alerts/'); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
    store.del('paired'); $('status').hidden = true; $('setup').hidden = false;
  });
  init();
})();
