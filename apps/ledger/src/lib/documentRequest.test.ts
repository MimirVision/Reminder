import { describe, expect, it } from 'vitest';
import { requestEmail } from './documentRequest';

const client = { name: 'Fjordlys Regnskap AS', contactName: 'Kari Nordmann' };

describe('the document request email', () => {
  it('is written in Norwegian, to the contact by first name, with each document on its own line', () => {
    const m = requestEmail({ lang: 'nb', client, docs: ['Kontoutskrifter oktober', 'Signert engasjementsbrev'], by: '2026-12-02', sender: 'Ola', again: false });
    expect(m.subject).toBe('Dokumenter vi trenger – Fjordlys Regnskap AS');
    expect(m.body).toContain('Hei Kari!');
    expect(m.body).toContain('• Kontoutskrifter oktober\n• Signert engasjementsbrev');
    expect(m.body).toContain('helst innen onsdag 2. desember');
    expect(m.body.endsWith('Med vennlig hilsen\nOla')).toBe(true);
  });

  it('says it is a reminder the second time, and works in English and without a contact name', () => {
    const m = requestEmail({ lang: 'en', client: { ...client, contactName: '' }, docs: ['Bank statements'], by: '2026-12-02', sender: '', again: true });
    expect(m.subject).toBe('Reminder: Documents we need – Fjordlys Regnskap AS');
    expect(m.body.startsWith('Hi,')).toBe(true);
    expect(m.body).toContain('ideally by Wednesday 2 December');
    expect(m.body.endsWith('Kind regards')).toBe(true);
  });
});
