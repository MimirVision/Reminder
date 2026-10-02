// Moving mode: a ready-made checklist for moving house in Norway, turned into ordinary to-dos with dates counted from moving day.
import type { Lang } from '../i18n/core';
import { addDays } from './when.ts';

export type MoveGroup = 'before' | 'packing' | 'day' | 'after';
export const MOVE_GROUPS: MoveGroup[] = ['before', 'packing', 'day', 'after'];

// offset = days from moving day (negative = before). Text is written for the item, not translated word by word.
export const MOVE_ITEMS: { key: string; group: MoveGroup; offset: number; en: string; nb: string }[] = [
  { key: 'help', group: 'before', offset: -35, en: 'Book moving help or a van', nb: 'Bestill flytte-hjelp eller flyttebil' },
  { key: 'boxes', group: 'before', offset: -30, en: 'Get moving boxes, tape and marker pens', nb: 'Skaff flyttekartonger, tape og tusjer' },
  { key: 'sort', group: 'before', offset: -30, en: 'Sort out what to keep, give away or throw', nb: 'Sorter ut hva du beholder, gir bort eller kaster' },
  { key: 'internet', group: 'before', offset: -28, en: 'Move or cancel the internet subscription', nb: 'Flytt eller si opp internettabonnementet' },
  { key: 'power', group: 'before', offset: -28, en: 'Arrange a power contract (strøm) for the new address', nb: 'Ordne strømavtale for ny adresse' },
  { key: 'insurance', group: 'before', offset: -21, en: 'Check that contents insurance (innbo) covers the new address', nb: 'Sjekk at innboforsikringen gjelder ny adresse' },
  { key: 'post', group: 'before', offset: -14, en: 'Set up mail forwarding with Posten', nb: 'Bestill adresseendring og ettersending hos Posten' },
  { key: 'elevator', group: 'before', offset: -14, en: 'Reserve the lift or a parking spot at the building, if needed', nb: 'Reserver heis eller parkeringsplass i bygget ved behov' },
  { key: 'school', group: 'before', offset: -14, en: 'Tell school, kindergarten and employer about the move', nb: 'Si fra til skole, barnehage og arbeidsgiver om flyttingen' },
  { key: 'freezer', group: 'before', offset: -7, en: 'Run down the freezer and fridge', nb: 'Spis ned fryseren og kjøleskapet' },
  { key: 'firstnight', group: 'before', offset: -7, en: 'Pack a first-night box: chargers, toiletries, kettle, bedding', nb: 'Pakk en første-natt-boks: ladere, toalettsaker, vannkoker, sengetøy' },
  { key: 'pack-kitchen', group: 'packing', offset: -6, en: 'Pack the kitchen', nb: 'Pakk kjøkkenet' },
  { key: 'pack-living', group: 'packing', offset: -5, en: 'Pack the living room', nb: 'Pakk stua' },
  { key: 'pack-bedrooms', group: 'packing', offset: -4, en: 'Pack the bedrooms', nb: 'Pakk soverommene' },
  { key: 'pack-bathroom', group: 'packing', offset: -2, en: 'Pack the bathroom', nb: 'Pakk badet' },
  { key: 'pack-storage', group: 'packing', offset: -3, en: 'Pack the garage, basement and storage', nb: 'Pakk garasje, kjeller og bod' },
  { key: 'label', group: 'packing', offset: -3, en: 'Label every box with its room', nb: 'Merk hver eske med rommet den skal til' },
  { key: 'clean', group: 'day', offset: 0, en: 'Clean the old home (flyttevask)', nb: 'Flyttevask i gammel bolig' },
  { key: 'meter-old', group: 'day', offset: 0, en: 'Take meter readings at the old home and photograph its condition', nb: 'Ta målerstand og bilder av tilstanden i gammel bolig' },
  { key: 'keys', group: 'day', offset: 0, en: 'Hand over the old keys and collect the new ones', nb: 'Lever nøklene til gammel bolig og hent de nye' },
  { key: 'meter-new', group: 'day', offset: 0, en: 'Take meter readings in the new home and note where the fuse box and water shutoff are', nb: 'Ta målerstand i ny bolig og finn sikringsskapet og stoppekranen' },
  { key: 'beds', group: 'day', offset: 0, en: 'Make the beds first', nb: 'Re opp sengene først' },
  { key: 'folkereg', group: 'after', offset: 1, en: 'Report the move to Folkeregisteret (within 8 days)', nb: 'Meld flytting til Folkeregisteret (innen 8 dager)' },
  { key: 'smoke', group: 'after', offset: 2, en: 'Check smoke alarms and the fire extinguisher in the new home', nb: 'Sjekk røykvarslere og brannslokker i ny bolig' },
  { key: 'bank', group: 'after', offset: 3, en: 'Give your new address to the bank, insurers and subscriptions', nb: 'Gi ny adresse til bank, forsikring og abonnementer' },
  { key: 'house', group: 'after', offset: 14, en: 'Set up the house calendar for the new home (House tab)', nb: 'Sett opp husets vedlikeholdskalender for ny bolig (Hus-fanen)' },
  { key: 'neighbours', group: 'after', offset: 14, en: 'Say hi to the neighbours', nb: 'Si hei til naboene' },
];

export type MoveTodo = { key: string; group: MoveGroup; body: string; due_on: string | null };

/** The to-dos for the ticked items. With a moving day each gets a date counted from it (never in the past, so it shows up now). */
export function buildMoveTodos(keys: string[], moveDay: string | null, lang: Lang, today: string): MoveTodo[] {
  const pick = new Set(keys);
  return MOVE_ITEMS.filter((i) => pick.has(i.key)).map((i) => {
    let due = moveDay ? addDays(moveDay, i.offset) : null;
    if (due && due < today) due = today;
    return { key: i.key, group: i.group, body: lang === 'nb' ? i.nb : i.en, due_on: due };
  });
}
