// The email that asks a client for documents, in Norwegian or English. Plain text, so it reads the same in every
// email program; the person sends it from their own mailbox.
import type { ISODate } from './dates';
import type { Client } from './types';

export type Lang = 'nb' | 'en';

const nbDate = (d: ISODate) => new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const enDate = (d: ISODate) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/** The email, in the client's language. Plain text, so it reads the same in every email program. */
export function requestEmail(o: { lang: Lang; client: Pick<Client, 'name' | 'contactName'>; docs: string[]; by: ISODate; sender: string; again: boolean }) {
  const first = o.client.contactName.trim().split(/\s+/)[0];
  const list = o.docs.map((d) => `• ${d}`).join('\n');
  if (o.lang === 'nb') {
    return {
      subject: `${o.again ? 'Påminnelse: ' : ''}Dokumenter vi trenger – ${o.client.name}`,
      body: [
        `Hei${first ? ` ${first}` : ''}!`, '',
        o.again ? 'Vi har ennå ikke mottatt alt vi trenger for å komme videre. Det som mangler er:' : 'For å komme videre trenger vi følgende fra dere:',
        '', list, '',
        `Send det gjerne så snart som mulig, og helst innen ${nbDate(o.by)}.`, '',
        'Med vennlig hilsen', o.sender,
      ].join('\n').trimEnd(),
    };
  }
  return {
    subject: `${o.again ? 'Reminder: ' : ''}Documents we need – ${o.client.name}`,
    body: [
      `Hi${first ? ` ${first}` : ''},`, '',
      o.again ? 'We still haven’t received everything we need to move on. What’s missing is:' : 'To move on, we need the following from you:',
      '', list, '',
      `Please send them as soon as you can, ideally by ${enDate(o.by)}.`, '',
      'Kind regards', o.sender,
    ].join('\n').trimEnd(),
  };
}
