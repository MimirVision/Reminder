export type MemoryStatus = 'inbox' | 'active' | 'done' | 'dismissed';

export type Household = { id: string; name: string; invite_code: string };

export type Place = {
  id: string;
  household_id: string;
  name: string;
  kind: 'fixed' | 'category';
  category: string | null;
  lat: number | null;
  lon: number | null;
  radius_m: number;
};

export type Memory = {
  id: string;
  household_id: string;
  author_id: string;
  body: string;
  status: MemoryStatus;
  place_id: string | null;
  place_category: string | null;
  created_at: string;
  done_at: string | null;
};

export type Media = { id: string; memory_id: string; storage_path: string; kind: 'photo' | 'voice' };

export type Member = { user_id: string; display_name: string | null };

// Keep in sync with apps/mobile/src/core/types.ts
export type MaintenanceTask = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  zone: 'house' | 'garden' | 'other';
  schedule: 'interval' | 'seasonal';
  interval_months: number | null;
  window_start_month: number | null;
  window_end_month: number | null;
  next_due_at: string;
  due_until: string | null;
  last_done_at: string | null;
  active: boolean;
};

export type MaintenanceEvent = { id: string; done_at: string; cost_nok: number | null; note: string | null };

export type HouseProfile = {
  has_garden: boolean;
  has_wood_stove: boolean;
  has_heat_pump: boolean;
  has_balanced_ventilation: boolean;
  has_septic: boolean;
  has_well: boolean;
  has_basement: boolean;
  has_wooden_facade: boolean;
};
