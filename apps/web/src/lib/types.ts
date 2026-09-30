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
