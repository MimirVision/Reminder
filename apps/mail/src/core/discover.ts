// "You only type your email address": work out the server settings and the easiest way to sign in.

export type AuthMethod = 'oauth-google' | 'oauth-microsoft' | 'app-password' | 'password';

export interface ServerSettings {
  host: string;
  port: number;
  // imap: tls = implicit TLS. smtp: 'tls' = implicit TLS (465), 'starttls' = upgrade (587).
  security: 'tls' | 'starttls';
}

export interface Discovery {
  provider: 'gmail' | 'icloud' | 'outlook' | 'generic';
  label: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  auth: AuthMethod[]; // easiest first
  helpUrl?: string;
}

const GMAIL: Discovery = {
  provider: 'gmail',
  label: 'Gmail',
  imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
  auth: ['oauth-google', 'app-password'],
  helpUrl: 'https://myaccount.google.com/apppasswords',
};
const ICLOUD: Discovery = {
  provider: 'icloud',
  label: 'iCloud Mail',
  imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
  auth: ['app-password'],
  helpUrl: 'https://account.apple.com/account/manage',
};
const OUTLOOK: Discovery = {
  provider: 'outlook',
  label: 'Outlook',
  imap: { host: 'outlook.office365.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' },
  auth: ['oauth-microsoft'],
};

const DOMAINS: Record<string, Discovery> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'icloud.com': ICLOUD,
  'me.com': ICLOUD,
  'mac.com': ICLOUD,
  'outlook.com': OUTLOOK,
  'hotmail.com': OUTLOOK,
  'live.com': OUTLOOK,
  'msn.com': OUTLOOK,
  'outlook.no': OUTLOOK,
  'hotmail.no': OUTLOOK,
  'live.no': OUTLOOK,
};

export function validateEmail(input: string): { ok: true; email: string; domain: string } | { ok: false; reason: string } {
  const email = input.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'Type your email address.' };
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/.exec(email);
  if (!m) return { ok: false, reason: 'That does not look like an email address yet.' };
  return { ok: true, email, domain: m[1] };
}

export function discoverKnown(domain: string): Discovery | null {
  return DOMAINS[domain.toLowerCase()] ?? null;
}

// For custom domains: what the MX records say about who really hosts the mail.
export function classifyMx(hosts: string[]): Discovery | null {
  const h = hosts.map((x) => x.toLowerCase().replace(/\.$/, ''));
  if (h.some((x) => /(^|\.)(google|googlemail)\.com$/.test(x))) return { ...GMAIL, label: 'Google Workspace' };
  if (h.some((x) => /(^|\.)(mail\.protection\.)?outlook\.com$/.test(x))) return { ...OUTLOOK, label: 'Microsoft 365' };
  if (h.some((x) => /(^|\.)(mail\.me|icloud)\.com$/.test(x))) return { ...ICLOUD, label: 'iCloud Mail (custom domain)' };
  return null;
}

// Mozilla's public ISP database knows the settings of thousands of providers.
export function autoconfigUrls(domain: string): string[] {
  return [`https://autoconfig.thunderbird.net/v1.1/${domain}`, `https://autoconfig.${domain}/mail/config-v1.1.xml`];
}

function server(xml: string, kind: 'incomingServer' | 'outgoingServer', type: string): ServerSettings | null {
  const re = new RegExp(`<${kind}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${kind}>`, 'i');
  const m = re.exec(xml);
  if (!m) return null;
  const pick = (tag: string) => new RegExp(`<${tag}>\\s*([^<\\s]+)\\s*</${tag}>`, 'i').exec(m[1])?.[1];
  const host = pick('hostname');
  const port = Number(pick('port'));
  const sock = (pick('socketType') ?? '').toUpperCase();
  if (!host || !port || (sock !== 'SSL' && sock !== 'STARTTLS')) return null;
  return { host, port, security: sock === 'SSL' ? 'tls' : 'starttls' };
}

export function parseAutoconfig(xml: string, email: string): Discovery | null {
  const imap = server(xml, 'incomingServer', 'imap');
  const smtp = server(xml, 'outgoingServer', 'smtp');
  if (!imap || !smtp) return null;
  // IMAP must use TLS from the first byte; we do not support STARTTLS on the IMAP side.
  if (imap.security !== 'tls') return null;
  const domain = email.split('@')[1] ?? '';
  return { provider: 'generic', label: domain, imap, smtp, auth: ['password'] };
}
