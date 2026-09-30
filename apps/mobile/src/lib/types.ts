import type { MemoryRow, PlaceRow } from '../core/types.ts';

export type Household = { id: string; name: string; invite_code: string };

export type Memory = MemoryRow & {
  household_id: string;
  author_id: string;
  created_at: string;
  done_at: string | null;
};

export type Place = PlaceRow & { household_id: string };

export type Member = { user_id: string; display_name: string | null };

export type CaptureKey = { id: string; label: string; created_at: string; last_used_at: string | null };
