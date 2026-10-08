import test from 'node:test';
import assert from 'node:assert/strict';
import { autoconfigUrls, classifyMx, discoverKnown, parseAutoconfig, validateEmail } from './discover.ts';
import { explainLoginFailure } from './errors.ts';

test('validateEmail trims, lower-cases and gives a friendly reason', () => {
  assert.deepEqual(validateEmail('  Andreas@Gmail.COM '), { ok: true, email: 'andreas@gmail.com', domain: 'gmail.com' });
  assert.equal(validateEmail('').ok, false);
  assert.equal(validateEmail('andreas@').ok, false);
  assert.equal(validateEmail('andreas@gmail').ok, false);
});

test('known providers give the right servers and the easiest sign-in first', () => {
  const g = discoverKnown('gmail.com')!;
  assert.equal(g.imap.host, 'imap.gmail.com');
  assert.deepEqual(g.auth, ['oauth-google', 'app-password']);
  const i = discoverKnown('me.com')!;
  assert.equal(i.smtp.security, 'starttls');
  assert.deepEqual(i.auth, ['app-password']);
  assert.equal(discoverKnown('hotmail.no')!.provider, 'outlook');
  assert.equal(discoverKnown('example.no'), null);
});

test('classifyMx recognises Google Workspace, Microsoft 365 and iCloud custom domains', () => {
  assert.equal(classifyMx(['aspmx.l.google.com.', 'alt1.aspmx.l.google.com'])?.label, 'Google Workspace');
  assert.equal(classifyMx(['firma-no.mail.protection.outlook.com'])?.provider, 'outlook');
  assert.equal(classifyMx(['mx01.mail.icloud.com'])?.provider, 'icloud');
  assert.equal(classifyMx(['mail.hosting.example']), null);
});

test('parseAutoconfig reads IMAP and SMTP from a Mozilla ISP database file', () => {
  const xml = `<clientConfig><emailProvider id="example.no">
    <incomingServer type="imap"><hostname>imap.example.no</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.example.no</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider></clientConfig>`;
  const d = parseAutoconfig(xml, 'a@example.no')!;
  assert.deepEqual(d.imap, { host: 'imap.example.no', port: 993, security: 'tls' });
  assert.deepEqual(d.smtp, { host: 'smtp.example.no', port: 587, security: 'starttls' });
  assert.equal(parseAutoconfig('<nope/>', 'a@example.no'), null);
  assert.equal(parseAutoconfig(xml.replace('SSL', 'plain'), 'a@example.no'), null);
  assert.equal(autoconfigUrls('example.no')[0], 'https://autoconfig.thunderbird.net/v1.1/example.no');
});

test('explainLoginFailure gives an actionable message for the common provider replies', () => {
  assert.equal(explainLoginFailure('imap.gmail.com', 'Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)', 'ALERT').kind, 'app-password-required');
  assert.equal(explainLoginFailure('imap.gmail.com', 'Invalid credentials (Failure)', 'AUTHENTICATIONFAILED').kind, 'wrong-password');
  assert.match(explainLoginFailure('imap.mail.me.com', 'LOGIN failed.').fix, /app-specific password/);
  assert.equal(explainLoginFailure('imap.gmail.com', 'Please log in via your web browser: https://support.google.com/mail/accounts/answer/78754 (Failure)', 'WEBALERT').kind, 'web-login');
  assert.equal(explainLoginFailure('imap.gmail.com', 'IMAP access is disabled for your domain.').kind, 'imap-disabled');
  assert.equal(explainLoginFailure('x', 'weird').kind, 'unknown');
});
