// The "get set up" checklist: which steps matter most for the app to keep helping after the first week.
// Pure (no imports of app code), so it is unit tested with plain Node (setup.test.ts).

import type { T } from '../i18n/core';

export type SetupStatus = { places: boolean; todos: boolean; calendar: boolean; emergency: boolean; reminders: boolean; partner: boolean };
export type SetupTarget = 'todo' | 'house' | 'places' | 'settings';

export type SetupStep = {
  id: keyof SetupStatus;
  title: string;
  why: string;
  cta: string;
  go: SetupTarget;
  done: boolean;
};

const ORDER: [keyof SetupStatus, SetupTarget][] = [
  ['places', 'places'], ['todos', 'todo'], ['calendar', 'house'], ['emergency', 'house'], ['reminders', 'settings'], ['partner', 'settings'],
];

export function buildSteps(s: SetupStatus, t: T): SetupStep[] {
  return ORDER.map(([id, go]) => ({
    id, go, done: s[id],
    title: t(`setup.${id}.title` as const), why: t(`setup.${id}.why` as const), cta: t(`setup.${id}.cta` as const),
  }));
}

export function progress(steps: SetupStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((x) => x.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}
