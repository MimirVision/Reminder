import type { Fact } from '../core/facts.ts';
import type { MaintenanceTask as CoreTask, MemoryRow, PlaceRow } from '../core/types.ts';

export type Household = { id: string; name: string; invite_code: string };

export type Suggestion = {
  kind: 'existing_place' | 'category' | 'recurring';
  place_id?: string;
  category?: string;
  recurring?: { title: string; schedule: 'interval' | 'seasonal'; interval_months?: number; window_start?: number; window_end?: number };
  label: string;
  reason: string;
  confidence: 'high' | 'medium';
};

export type Memory = MemoryRow & {
  suggestion: Suggestion | null;
  suggested_at: string | null;
  household_id: string;
  author_id: string;
  created_at: string;
  done_at: string | null;
  done_by?: string | null;
  due_on: string | null;
  due_time: string | null;
  repeat_rule?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  assignee_id?: string | null; // who it is for (null = anyone)
  pinned?: boolean;
  pending?: boolean; // saved on this phone, waiting for a connection
};

export type Place = PlaceRow & { household_id: string; address?: string | null };

export type Member = { user_id: string; display_name: string | null };

export type CaptureKey = { id: string; label: string; created_at: string; last_used_at: string | null };

export type MaintenanceTask = CoreTask & { household_id: string; template_key?: string | null };

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

export type HouseFact = Fact & { household_id: string };
