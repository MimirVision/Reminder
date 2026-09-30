export type FactCategory = 'emergency' | 'measurement' | 'paint' | 'appliance' | 'other';

export type Fact = {
  id: string;
  title: string;
  value: string;
  category: FactCategory;
  surface_at: string[];
};

export const FACT_LABELS: Record<FactCategory, string> = {
  emergency: 'Emergency',
  measurement: 'Measurements',
  paint: 'Paint and finishes',
  appliance: 'Appliances and parts',
  other: 'Other',
};

const ORDER: FactCategory[] = ['emergency', 'measurement', 'paint', 'appliance', 'other'];

// Facts tagged for this kind of shop ("hardware", "paint", ...), shown on the store list as "Useful here".
export function factsForCategory(facts: Fact[], category: string | null): Fact[] {
  if (!category) return [];
  return facts.filter((f) => f.surface_at.includes(category));
}

export function groupFacts(facts: Fact[]): { category: FactCategory; label: string; items: Fact[] }[] {
  return ORDER.map((category) => ({
    category,
    label: FACT_LABELS[category],
    items: facts.filter((f) => f.category === category).sort((a, b) => a.title.localeCompare(b.title, 'nb')),
  })).filter((g) => g.items.length > 0);
}
