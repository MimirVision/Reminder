// The "get set up" checklist: which steps matter most for the app to keep helping after the first week.
// Pure (no imports of app code), so it is unit tested with plain Node (setup.test.ts).

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

export function buildSteps(s: SetupStatus): SetupStep[] {
  return [
    { id: 'places', title: 'Add a place', why: 'Something like "Any pharmacy" so a to-do can wait for the right shop.', cta: 'Add places', go: 'places', done: s.places },
    { id: 'todos', title: 'Add your first to-do', why: 'Write it once and stop carrying it in your head.', cta: 'Add a to-do', go: 'todo', done: s.todos },
    { id: 'calendar', title: 'Create your house calendar', why: 'Gutters, smoke detectors, filters: the upkeep you would otherwise forget.', cta: 'Set up the house', go: 'house', done: s.calendar },
    { id: 'emergency', title: 'Fill in the emergency card', why: 'Where the water shutoff and fuse box are. Save it now, thank yourself later.', cta: 'Add facts', go: 'house', done: s.emergency },
    { id: 'reminders', title: 'Turn on iPhone reminders', why: 'A notification when you arrive at a place, and a summary every Sunday.', cta: 'Set up reminders', go: 'settings', done: s.reminders },
    { id: 'partner', title: 'Invite your partner', why: 'So things they need you to buy land in the same list.', cta: 'Send an invite', go: 'settings', done: s.partner },
  ];
}

export function progress(steps: SetupStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((x) => x.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}
