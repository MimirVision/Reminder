// Turns what a mail server says when a login fails into something a person can act on.

export type FailureKind = 'wrong-password' | 'app-password-required' | 'web-login' | 'imap-disabled' | 'unknown';

export interface Explained {
  kind: FailureKind;
  title: string;
  fix: string;
}

export function explainLoginFailure(host: string, text: string, code?: string): Explained {
  const t = `${code ?? ''} ${text}`;
  const icloud = /mail\.me\.com|icloud/i.test(host);
  const google = /gmail|google/i.test(host);

  if (/application-specific password|185833/i.test(t))
    return {
      kind: 'app-password-required',
      title: 'Google wants an app password',
      fix: 'Your normal Google password cannot be used here. Create an app password (2-step verification must be on) and paste it instead.',
    };
  if (/web ?login|log in via your web browser|WEBALERT|sign in.*browser/i.test(t))
    return {
      kind: 'web-login',
      title: 'Google blocked this sign-in',
      fix: 'Open Gmail in a browser, approve the security alert about this sign-in, then try again.',
    };
  if (/imap.*(disabled|not enabled)|disabled.*imap|IMAP access/i.test(t))
    return {
      kind: 'imap-disabled',
      title: 'Mail access is switched off for this account',
      fix: google ? 'In Gmail settings, open Forwarding and POP/IMAP and turn IMAP on.' : 'Turn on IMAP access in your mail provider settings.',
    };
  if (/AUTHENTICATIONFAILED|invalid credentials|login failed|authentication failed|incorrect|username and password/i.test(t))
    return {
      kind: 'wrong-password',
      title: icloud ? 'iCloud did not accept that password' : 'That email or password was not accepted',
      fix: icloud
        ? 'Use an app-specific password from your Apple Account page, not your Apple Account password.'
        : google
          ? 'Check the app password has no typos. Spaces do not matter.'
          : 'Check the email address and password, and that your provider allows mail apps.',
    };
  return { kind: 'unknown', title: 'The mail server said no', fix: text || 'Try again in a minute.' };
}
