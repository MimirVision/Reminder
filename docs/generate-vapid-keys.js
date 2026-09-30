// Paste this whole file into your browser's developer console (F12, tab "Console") and press Enter.
// It prints the two keys that notifications need. Nothing is sent anywhere.
(async () => {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const j = await crypto.subtle.exportKey('jwk', k.privateKey);
  const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const enc = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  console.log('VAPID_PUBLIC_KEY=' + enc(new Uint8Array([4, ...dec(j.x), ...dec(j.y)])));
  console.log('VAPID_PRIVATE_KEY=' + j.d);
})();
