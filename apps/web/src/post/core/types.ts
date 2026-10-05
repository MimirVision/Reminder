// Shapes shared by the Post web app's core. No browser or React code in src/post/core: everything here is unit tested in Node.

export type Kind = 'person' | 'newsletter' | 'receipt' | 'alert';

export interface Account {
  email: string;
  label: string; // "Personal", "Work", or whatever the user called it
  mode?: 'people' | 'all' | 'vips' | 'off';
  subscriptionExpiresAt?: string | null;
  lastAlertAt?: string | null;
}

/** One message as the list shows it. */
export interface Mail {
  key: string; // `${account}|${id}` : unique across accounts
  account: string;
  id: string;
  conversationId: string;
  received: string; // ISO
  subject: string;
  fromName: string;
  fromAddress: string;
  preview: string;
  isRead: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  folder: 'inbox' | 'archive' | 'deleted';
  kind: Kind;
  why: string[]; // plain-language reasons for `kind`, shown by "why is this here?"
  /** Set once the message headers have been read (they sharpen newsletter detection). */
  headersChecked?: boolean;
  /** Hidden until this time (ISO). Snooze lives on this device. */
  snoozedUntil?: string | null;
}

export interface MailBody {
  key: string;
  contentType: 'html' | 'text';
  content: string;
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  attachments: { id: string; name: string; size: number; contentType: string; inline: boolean }[];
}

export const mailKey = (account: string, id: string) => `${account}|${id}`;
