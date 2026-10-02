// Keep in sync with apps/mobile/src/core/facts.ts
export type FactCategory = 'emergency' | 'measurement' | 'paint' | 'appliance' | 'other';
export type Fact = { id: string; household_id: string; title: string; value: string; category: FactCategory; surface_at: string[] };

export const FACT_LABELS: Record<FactCategory, string> = {
  emergency: 'Emergency', measurement: 'Measurements', paint: 'Paint and finishes', appliance: 'Appliances and parts', other: 'Other',
};
export const FACT_ORDER: FactCategory[] = ['emergency', 'measurement', 'paint', 'appliance', 'other'];

export function factsForCategory(facts: Fact[], category: string | null): Fact[] {
  return category ? facts.filter((f) => (f.surface_at ?? []).includes(category)) : [];
}

export function groupFacts(facts: Fact[]) {
  return FACT_ORDER.map((category) => ({
    category, label: FACT_LABELS[category],
    items: facts.filter((f) => f.category === category).sort((a, b) => a.title.localeCompare(b.title, 'nb')),
  })).filter((g) => g.items.length > 0);
}
